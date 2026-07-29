/**
 * KV 기반 팀 스키마 저장 — content-addressed 불변 저장.
 *
 * 저장 내용의 해시가 곧 ID 다. 같은 스키마 = 같은 ID (저장은 멱등),
 * 스키마를 고치면 새 ID 가 나온다. 따라서 한 번 공유된 `_s=<id>` URL 은
 * 영원히 같은 데이터를 반환한다 — v1 의 결정론 보장이 저장 기능에도 그대로 유지된다.
 */
import { parseQuery } from './dsl';
import { DslError } from './registry';
import { hashString } from './rng';

/** Cloudflare KV 최소 인터페이스 — 테스트에서 인메모리 목으로 대체 */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string; metadata?: unknown }> }>;
}

export interface SavedSchema {
  id: string;
  name: string;
  res: string;
  /** 정규화(정렬)된 쿼리스트링 */
  query: string;
  createdAt: string;
}

export interface SavedMeta {
  id: string;
  name: string;
  res: string;
  createdAt: string;
}

const KEY_PREFIX = 's:';
const RES_RE = /^[A-Za-z0-9_-]{1,50}$/;
export const ID_RE = /^[a-z0-9]{4,16}$/;

function fail(error: string, hint: string): never {
  throw new DslError({ error, hint });
}

/** 쿼리 검증 + key 정렬 → 저장/ID 계산의 기준이 되는 정규형 */
export function canonicalQuery(query: string): string {
  const params = new URLSearchParams(query);
  params.delete('_s');
  parseQuery(new URLSearchParams(params)); // 유효성 검증 — 실패 시 DslError
  const entries = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

/** 리소스명 + 정규형 쿼리 → 10자 base36 ID (64bit 상당) */
export function schemaId(res: string, canonical: string): string {
  const s = `${res}?${canonical}`;
  const h1 = hashString(s).toString(36).padStart(7, '0');
  const h2 = hashString([...s].reverse().join('') + s.length).toString(36).padStart(7, '0');
  return (h1 + h2).slice(0, 10);
}

export async function saveSchema(kv: KVNamespaceLike, name: unknown, res: unknown, query: unknown): Promise<SavedSchema> {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    fail('Invalid name', '이름은 1~60자 문자열이어야 합니다.');
  }
  if (typeof res !== 'string' || !RES_RE.test(res)) {
    fail('Invalid resource', '리소스명은 영숫자/_/- 조합 1~50자입니다.');
  }
  if (typeof query !== 'string' || query === '') {
    fail('Invalid query', '저장할 스키마 쿼리스트링이 비어 있습니다.');
  }
  const canonical = canonicalQuery(query);
  const id = schemaId(res, canonical);
  const createdAt = new Date().toISOString();
  const rec: SavedSchema = { id, name: name.trim(), res, query: canonical, createdAt };
  await kv.put(KEY_PREFIX + id, JSON.stringify(rec), {
    metadata: { name: rec.name, res, createdAt },
  });
  return rec;
}

export async function getSchema(kv: KVNamespaceLike, id: string): Promise<SavedSchema | null> {
  if (!ID_RE.test(id)) return null;
  const raw = await kv.get(KEY_PREFIX + id);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SavedSchema;
  } catch {
    return null;
  }
}

export async function listSchemas(kv: KVNamespaceLike): Promise<SavedMeta[]> {
  const { keys } = await kv.list({ prefix: KEY_PREFIX, limit: 1000 });
  const items: SavedMeta[] = [];
  for (const k of keys) {
    const meta = (k.metadata ?? {}) as Partial<SavedMeta>;
    items.push({
      id: k.name.slice(KEY_PREFIX.length),
      name: meta.name ?? '(이름 없음)',
      res: meta.res ?? 'item',
      createdAt: meta.createdAt ?? '',
    });
  }
  // 최신 저장 순
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return items;
}

export async function deleteSchema(kv: KVNamespaceLike, id: string): Promise<boolean> {
  const rec = await getSchema(kv, id);
  if (!rec) return false;
  await kv.delete(KEY_PREFIX + id);
  return true;
}

/** 저장된 쿼리 + 요청 파라미터 병합 — 같은 키는 요청이 우선 (_page/_limit 오버라이드 등) */
export function mergeQuery(savedQuery: string, request: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(savedQuery);
  for (const [k] of request) {
    if (k === '_s') continue;
    out.delete(k);
  }
  for (const [k, v] of request) {
    if (k === '_s') continue;
    out.append(k, v);
  }
  return out;
}
