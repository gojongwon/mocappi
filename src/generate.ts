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

export function generateResponse(q: ParsedQuery): Envelope | unknown[] {
  const baseSeed = baseSeedOf(q);
  const start = (q.page - 1) * q.limit;
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

function setPath(obj: Record<string, unknown>, f: FieldSpec, value: unknown): void {
  let cur = obj;
  for (let i = 0; i < f.path.length - 1; i++) {
    const k = f.path[i];
    if (cur[k] === undefined) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[f.path[f.path.length - 1]] = value;
}
