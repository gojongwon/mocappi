/**
 * KV 기반 스키마 저장 — content-addressed 불변 저장 + 워크스페이스 격리.
 *
 * 저장 내용의 해시가 곧 ID 다. 같은 스키마 = 같은 ID (저장은 멱등),
 * 스키마를 고치면 새 ID 가 나온다. 따라서 한 번 공유된 `_s=<sid>` URL 은
 * 영원히 같은 데이터를 반환한다.
 *
 * 워크스페이스: 랜덤 ID 를 아는 사람만 그 목록에 접근하는 capability-URL 모델.
 *  - sid 형식: "<ws>.<id>" (워크스페이스) 또는 "<id>" (공용 풀 — 기존 데이터 호환)
 *  - KV 키:    w:<ws>:<id>            또는 s:<id>
 *  - 워크스페이스 저장물은 TTL(180일) — 재저장(멱등)하면 갱신. 공용 풀은 무기한.
 */
import { parseQuery } from './dsl';
import { DslError } from './registry';
import { hashString } from './rng';

/** Cloudflare KV 최소 인터페이스 — 테스트에서 인메모리 목으로 대체 */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string; metadata?: unknown }> }>;
}

export interface SavedSchema {
  id: string;
  /** 전체 참조자 — "<ws>.<id>" 또는 "<id>" */
  sid: string;
  ws: string | null;
  name: string;
  res: string;
  /** 정규화(정렬)된 쿼리스트링 */
  query: string;
  createdAt: string;
}

export interface SavedMeta {
  id: string;
  sid: string;
  name: string;
  res: string;
  createdAt: string;
}

const RES_RE = /^[A-Za-z0-9_-]{1,50}$/;
const ID_RE = /^[a-z0-9]{4,16}$/;
export const WS_RE = /^[a-z0-9]{6,24}$/;
export const MAX_PER_WORKSPACE = 100;
const WS_TTL_SECONDS = 60 * 60 * 24 * 180; // 180일 — 재저장 시 갱신

function fail(error: string, hint: string): never {
  throw new DslError({ error, hint });
}

function keyOf(ws: string | null, id: string): string {
  return ws ? `w:${ws}:${id}` : `s:${id}`;
}

function prefixOf(ws: string | null): string {
  return ws ? `w:${ws}:` : 's:';
}

export function sidOf(ws: string | null, id: string): string {
  return ws ? `${ws}.${id}` : id;
}

/** "<ws>.<id>" 또는 "<id>" 파싱. 형식이 아니면 null */
export function parseSid(sid: string): { ws: string | null; id: string } | null {
  const dot = sid.indexOf('.');
  if (dot === -1) {
    return ID_RE.test(sid) ? { ws: null, id: sid } : null;
  }
  const ws = sid.slice(0, dot);
  const id = sid.slice(dot + 1);
  return WS_RE.test(ws) && ID_RE.test(id) ? { ws, id } : null;
}

export function validateWs(ws: unknown): string | null {
  if (ws === undefined || ws === null || ws === '') return null;
  if (typeof ws !== 'string' || !WS_RE.test(ws)) {
    fail('Invalid workspace', '워크스페이스 ID 는 소문자 영숫자 6~24자입니다.');
  }
  return ws;
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

export async function saveSchema(
  kv: KVNamespaceLike,
  ws: string | null,
  name: unknown,
  res: unknown,
  query: unknown,
): Promise<SavedSchema> {
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
  const key = keyOf(ws, id);

  // 남용 방어: 워크스페이스당 저장 개수 상한 (재저장/이름변경은 기존 키라 허용)
  const exists = (await kv.get(key)) !== null;
  if (!exists) {
    const { keys } = await kv.list({ prefix: prefixOf(ws), limit: MAX_PER_WORKSPACE });
    if (keys.length >= MAX_PER_WORKSPACE) {
      fail('Workspace full', `워크스페이스당 최대 ${MAX_PER_WORKSPACE}개까지 저장할 수 있습니다. 안 쓰는 항목을 삭제하세요.`);
    }
  }

  const createdAt = new Date().toISOString();
  const rec: SavedSchema = { id, sid: sidOf(ws, id), ws, name: name.trim(), res, query: canonical, createdAt };
  await kv.put(key, JSON.stringify(rec), {
    metadata: { name: rec.name, res, createdAt },
    ...(ws ? { expirationTtl: WS_TTL_SECONDS } : {}), // 공용 풀은 무기한 (기존 팀 데이터 보존)
  });
  return rec;
}

export async function getSchema(kv: KVNamespaceLike, sid: string): Promise<SavedSchema | null> {
  const parsed = parseSid(sid);
  if (!parsed) return null;
  const raw = await kv.get(keyOf(parsed.ws, parsed.id));
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as SavedSchema;
    // 구버전 레코드(sid/ws 없음) 호환
    rec.ws = parsed.ws;
    rec.sid = sidOf(parsed.ws, parsed.id);
    return rec;
  } catch {
    return null;
  }
}

export async function listSchemas(kv: KVNamespaceLike, ws: string | null): Promise<SavedMeta[]> {
  const prefix = prefixOf(ws);
  const { keys } = await kv.list({ prefix, limit: 1000 });
  const items: SavedMeta[] = [];
  for (const k of keys) {
    const meta = (k.metadata ?? {}) as Partial<SavedMeta>;
    const id = k.name.slice(prefix.length);
    items.push({
      id,
      sid: sidOf(ws, id),
      name: meta.name ?? '(이름 없음)',
      res: meta.res ?? 'item',
      createdAt: meta.createdAt ?? '',
    });
  }
  // 최신 저장 순
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return items;
}

export async function deleteSchema(kv: KVNamespaceLike, sid: string): Promise<boolean> {
  const parsed = parseSid(sid);
  if (!parsed) return false;
  const key = keyOf(parsed.ws, parsed.id);
  if ((await kv.get(key)) === null) return false;
  await kv.delete(key);
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
