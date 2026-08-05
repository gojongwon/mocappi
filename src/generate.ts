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
import type { FieldSpec, ParsedQuery, SortKey } from './dsl';

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
 * _q 검색·_sort 정렬 — 가상 아이템을 실제로 생성해 훑어야 하므로 CPU 예산(무료 10ms)
 * 때문에 앞 SEARCH_SCAN_MAX 개 창 안에서만 본다. 둘 다 시드에서 제외되므로
 * "같은 데이터에서 필터·순서만" — i 번째 아이템 자체는 언제나 동일하다.
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

/** 창 안의 아이템 전체 — 필터·정렬 이전의 원본 순서. 상태 오버레이(state.ts)도 이 창 위에서 동작한다 */
export function windowItems(q: ParsedQuery): Record<string, unknown>[] {
  const baseSeed = baseSeedOf(q);
  const scan = Math.min(q.total, SEARCH_SCAN_MAX);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < scan; i++) out.push(generateItem(baseSeed, i, q));
  return out;
}

/** _q 매치 판정 — _qin 이 있으면 해당 경로의 값만 대상 */
function matchesQ(item: Record<string, unknown>, q: ParsedQuery): boolean {
  const needle = (q.q ?? '').toLowerCase();
  return q.qin ? q.qin.some((p) => matchValue(valueAt(item, p), needle)) : matchValue(item, needle);
}

/** 검색 창 안의 매치 전체 (페이지 슬라이스 전) */
function searchMatches(q: ParsedQuery): Record<string, unknown>[] {
  return windowItems(q).filter((item) => matchesQ(item, q));
}

/**
 * 정렬 비교 — 코드포인트 순서. `localeCompare` 는 쓰지 않는다: 런타임의 ICU 유무에 따라
 * 결과가 갈리면 "같은 URL 이면 같은 바이트" 가 깨진다. 한글·가나 음절은 코드포인트 순서가
 * 이미 사전 순이라 실용적으로도 충분하다.
 */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** 빈 값은 방향과 무관하게 항상 뒤 — null 이 목록 맨 앞을 차지하면 정렬을 쓸 수 없다 */
function compareKey(a: unknown, b: unknown, desc: boolean): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  const c = compareValues(a, b);
  return desc ? -c : c;
}

/** 창 안 아이템 정렬. sort 는 안정 정렬이라 동률은 생성 순서를 유지한다 → 결정적 */
function sortItems(items: Record<string, unknown>[], keys: SortKey[]): Record<string, unknown>[] {
  return [...items].sort((x, y) => {
    for (const k of keys) {
      const c = compareKey(valueAt(x, k.path), valueAt(y, k.path), k.desc);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** 창 안에서 _q 필터와 _sort 정렬을 적용한 최종 후보 (페이지 슬라이스 전) */
export function viewItems(q: ParsedQuery): Record<string, unknown>[] {
  const items = q.q !== null ? searchMatches(q) : windowItems(q);
  return q.sort !== null ? sortItems(items, q.sort) : items;
}

/**
 * 목록 응답 + 전체 개수. 개수를 따로 돌려주는 건 X-Total-Count 헤더 때문이다 —
 * _wrap=none 의 배열은 페이지 조각이라 길이에서 전체 개수를 되돌릴 수 없고,
 * 헤더용으로 뷰를 한 번 더 생성하면 CPU 예산(무료 10ms)이 아깝다.
 */
export function listResponse(q: ParsedQuery): { body: Envelope | unknown[] | Record<string, unknown>; total: number } {
  // _wrap=one — 상세 엔드포인트용 단일 객체. 리스트 URL 의 첫 아이템과 동일한 값
  // (개체별로 다른 데이터는 _seed=<id> 로: /api/users/123?_wrap=one&_seed=123)
  if (q.wrap === 'one') {
    return { body: generateItem(baseSeedOf(q), 0, q), total: 1 };
  }
  const start = (q.page - 1) * q.limit;

  // 검색 모드 — total 은 매치 수 (실제 검색 API 의 의미론)
  if (q.q !== null) {
    const matches = viewItems(q);
    const total = matches.length;
    const data = matches.slice(start, start + q.limit);
    if (q.wrap === 'none') return { body: data, total };
    const totalPages = Math.max(1, Math.ceil(total / q.limit));
    return {
      body: {
        data,
        page: q.page,
        limit: q.limit,
        total,
        totalPages,
        hasNext: q.page < totalPages && total > 0,
        hasPrev: q.page > 1,
      },
      total,
    };
  }

  // 정렬 모드도 창 안에서 전체를 만든 뒤 자른다 → total 은 창 개수 (_q 와 같은 규칙)
  const sorted = q.sort !== null ? viewItems(q) : null;
  const total = sorted ? sorted.length : q.total;
  let data: unknown[];
  if (sorted) {
    data = sorted.slice(start, start + q.limit);
  } else {
    const baseSeed = baseSeedOf(q);
    // 마지막 페이지 잘림 / 범위 초과 페이지 → 빈 배열 (에러 아님)
    const count = Math.max(0, Math.min(q.limit, q.total - start));
    data = [];
    for (let i = 0; i < count; i++) {
      data.push(generateItem(baseSeed, start + i, q));
    }
  }
  if (q.wrap === 'none') return { body: data, total };
  const totalPages = Math.ceil(total / q.limit);
  return {
    body: {
      data,
      page: q.page,
      limit: q.limit,
      total,
      totalPages,
      hasNext: q.page < totalPages,
      hasPrev: q.page > 1,
    },
    total,
  };
}

export function generateResponse(q: ParsedQuery): Envelope | unknown[] | Record<string, unknown> {
  return listResponse(q).body;
}

/**
 * 미리 병합된 아이템 목록(상태 오버레이 적용 후)에서 목록 응답 — state.ts 전용.
 * _q/_sort 는 병합된 항목 위에서 동작한다: 생성한 아이템도 검색·정렬에 걸린다.
 * total 은 병합 후 개수 — 생성하면 늘고 삭제하면 준다 (검색 모드와 같은 창 규칙).
 * 기존 무상태 경로(listResponse)와 분리해 둔 이유: 그쪽 envelope 바이트는
 * 결정성 약속에 묶여 있어 한 글자도 못 건드린다.
 */
/** 주어진 아이템 목록에 _q 필터·_sort 정렬 적용 — 상태 병합 창의 뷰 계산용 */
export function applyView(q: ParsedQuery, items: Record<string, unknown>[]): Record<string, unknown>[] {
  if (q.q !== null) items = items.filter((it) => matchesQ(it, q));
  if (q.sort !== null) items = sortItems(items, q.sort);
  return items;
}

export function listResponseFrom(
  q: ParsedQuery,
  merged: Record<string, unknown>[],
): { body: Envelope | unknown[]; total: number } {
  const items = applyView(q, merged);
  const total = items.length;
  const start = (q.page - 1) * q.limit;
  const data = items.slice(start, start + q.limit);
  if (q.wrap === 'none') return { body: data, total };
  const totalPages = Math.max(1, Math.ceil(total / q.limit));
  return {
    body: {
      data,
      page: q.page,
      limit: q.limit,
      total,
      totalPages,
      hasNext: q.page < totalPages && total > 0,
      hasPrev: q.page > 1,
    },
    total,
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
