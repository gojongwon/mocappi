/**
 * 시드 기반 항목 생성 + 페이지네이션.
 *
 * 결정론 핵심:
 *   baseSeed  = hash(정규화 쿼리)  ← _page/_limit/_delay/_status/_wrap 제외
 *   itemSeed  = hash(baseSeed, globalIdx)      globalIdx = (_page-1)*_limit + i
 *   fieldSeed = hash(baseSeed, globalIdx, 필드명)
 *
 * 전역 인덱스 i 번째 항목은 페이지 크기와 무관하게 항상 동일하다.
 */
import { combineSeed, hashString } from './rng';
import type { GenContext } from './registry';
import type { FieldSpec, ParsedQuery } from './dsl';

export interface Envelope {
  data: unknown[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function baseSeedOf(q: ParsedQuery): number {
  return q.seedParam !== null ? hashString('explicit-seed:' + q.seedParam) : hashString(q.normalized);
}

export function generateItem(baseSeed: number, globalIndex: number, q: ParsedQuery): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  const ctx: GenContext = { globalIndex, locale: q.locale };
  for (const f of q.fields) {
    const fieldSeed = combineSeed(baseSeed, globalIndex, f.name);
    let value: unknown;
    if (f.isArray) {
      const arr: unknown[] = [];
      for (let j = 0; j < f.arrayLen; j++) arr.push(f.gen(combineSeed(fieldSeed, j), ctx));
      value = arr;
    } else {
      value = f.gen(fieldSeed, ctx);
    }
    setPath(item, f, value);
  }
  return item;
}

/**
 * _q 검색 — 가상 아이템을 실제로 생성해 훑어야 하므로 CPU 예산(무료 10ms) 때문에
 * 앞 SEARCH_SCAN_MAX 개 창 안에서 검색한다. _q 는 시드에서 제외되므로
 * "같은 데이터에서 필터만" — i 번째 아이템은 검색 유무와 무관하게 동일하다.
 */
export const SEARCH_SCAN_MAX = 1000;

function matchValue(v: unknown, needle: string): boolean {
  if (v === null || v === undefined || typeof v === 'boolean') return false;
  if (typeof v === 'string') return v.toLowerCase().includes(needle);
  if (typeof v === 'number') return String(v).includes(needle);
  if (Array.isArray(v)) return v.some((x) => matchValue(x, needle));
  if (typeof v === 'object') return Object.values(v).some((x) => matchValue(x, needle));
  return false;
}

/** 점 표기 경로의 값 — 경로가 끊기면 undefined */
function valueAt(item: Record<string, unknown>, path: string): unknown {
  let cur: unknown = item;
  for (const s of path.split('.')) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/** 검색 창 안의 매치 전체 (페이지 슬라이스 전). _qin 이 있으면 해당 경로의 값만 대상 */
export function searchMatches(q: ParsedQuery): Record<string, unknown>[] {
  const baseSeed = baseSeedOf(q);
  const needle = (q.q ?? '').toLowerCase();
  const scan = Math.min(q.total, SEARCH_SCAN_MAX);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < scan; i++) {
    const item = generateItem(baseSeed, i, q);
    const hit = q.qin
      ? q.qin.some((p) => matchValue(valueAt(item, p), needle))
      : matchValue(item, needle);
    if (hit) out.push(item);
  }
  return out;
}

export function generateResponse(q: ParsedQuery): Envelope | unknown[] {
  const start = (q.page - 1) * q.limit;

  // 검색 모드 — total 은 매치 수 (실제 검색 API 의 의미론)
  if (q.q !== null) {
    const matches = searchMatches(q);
    const data = matches.slice(start, start + q.limit);
    if (q.wrap === 'none') return data;
    const totalPages = Math.max(1, Math.ceil(matches.length / q.limit));
    return {
      data,
      page: q.page,
      limit: q.limit,
      total: matches.length,
      totalPages,
      hasNext: q.page < totalPages && matches.length > 0,
      hasPrev: q.page > 1,
    };
  }

  const baseSeed = baseSeedOf(q);
  // 마지막 페이지 잘림 / 범위 초과 페이지 → 빈 배열 (에러 아님)
  const count = Math.max(0, Math.min(q.limit, q.total - start));
  const data: unknown[] = [];
  for (let i = 0; i < count; i++) {
    data.push(generateItem(baseSeed, start + i, q));
  }
  if (q.wrap === 'none') return data;
  const totalPages = Math.ceil(q.total / q.limit);
  return {
    data,
    page: q.page,
    limit: q.limit,
    total: q.total,
    totalPages,
    hasNext: q.page < totalPages,
    hasPrev: q.page > 1,
  };
}

// ---------------------------------------------------------------------------
// CSV (_format=csv) — 중첩은 점 표기 컬럼, 배열은 JSON 문자열, RFC 4180 이스케이프
// ---------------------------------------------------------------------------

export function csvEscape(v: unknown): string {
  let s: string;
  if (v === null || v === undefined) s = '';
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvHeader(q: ParsedQuery): string {
  return q.fields.map((f) => csvEscape(f.path.join('.'))).join(',');
}

export function csvRow(item: Record<string, unknown>, q: ParsedQuery): string {
  return q.fields
    .map((f) => {
      let cur: unknown = item;
      for (const s of f.path) {
        cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[s] : undefined;
      }
      return csvEscape(cur);
    })
    .join(',');
}

function setPath(obj: Record<string, unknown>, f: FieldSpec, value: unknown): void {
  let cur = obj;
  for (let i = 0; i < f.path.length - 1; i++) {
    const k = f.path[i];
    if (cur[k] === undefined) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[f.path[f.path.length - 1]] = value;
}
