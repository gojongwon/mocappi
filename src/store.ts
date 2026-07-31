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

// 다단계 경로 허용 (최대 8단계). '*' 세그먼트는 라우트 모드의 와일드카드
// (예: users/* → /users/42 매치, 42 는 _seed 로 넘어간다)
const SEG = '(?:[A-Za-z0-9_-]+|\\*)';
const RES_RE = new RegExp(`^${SEG}(?:/${SEG}){0,7}$`);
const ID_RE = /^[a-z0-9]{4,16}$/;
export const WS_RE = /^[a-z0-9]{6,24}$/;
export const MAX_PER_WORKSPACE = 100;
const WS_TTL_SECONDS = 60 * 60 * 24 * 180; // 180일 — 재저장 시 갱신
const REWRITE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 동일 내용 재저장 시 7일 이내면 쓰기 스킵

function fail(error: string, hint: string, hintEn?: string): never {
  throw new DslError({ error, hint, hintEn });
}

function keyOf(ws: string | null, id: string): string {
  return ws ? `w:${ws}:${id}` : `s:${id}`;
}

function prefixOf(ws: string | null): string {
  return ws ? `w:${ws}:` : 's:';
}

// ---------------------------------------------------------------------------
// 라우트 인덱스 — /w/<ws>/<경로> 로 쿼리스트링 없이 호출하기 위한 경로 → sid 포인터.
// 프리셋 키(w:<ws>:<id>) 와 프리픽스를 분리해 listSchemas 가 포인터를 프리셋으로
// 오인하지 않게 한다. sid 를 metadata 에도 넣는 이유: list() 는 값을 주지 않으므로
// 메타데이터에 넣어야 조회 1회로 라우트 표 전체를 얻는다.
// ---------------------------------------------------------------------------
const routePrefix = (ws: string) => `r:${ws}:`;
/** '@' 는 RES_RE 로 만들 수 없어 경로와 절대 충돌하지 않는다 */
const MODE_SUFFIX = '@mode';

export interface RouteTable {
  routes: Array<{ path: string; sid: string }>;
  /** 워크스페이스 실패 모드 — 설정돼 있으면 모든 라우트가 이 상태코드로 실패한다 */
  mode: number | null;
}

/** 라우트 표 + 실패 모드를 list 한 번으로 (D1 읽기 1회) */
export async function listRoutes(kv: KVNamespaceLike, ws: string): Promise<RouteTable> {
  const prefix = routePrefix(ws);
  const { keys } = await kv.list({ prefix, limit: 1000 });
  const routes: Array<{ path: string; sid: string }> = [];
  let mode: number | null = null;
  for (const k of keys) {
    const tail = k.name.slice(prefix.length);
    const meta = (k.metadata ?? {}) as { sid?: string; status?: number };
    if (tail === MODE_SUFFIX) mode = typeof meta.status === 'number' ? meta.status : null;
    else if (meta.sid) routes.push({ path: tail, sid: meta.sid });
  }
  return { routes, mode };
}

/**
 * 요청 경로에 맞는 라우트. 정확 일치가 우선, 그다음 '*' 가 적은 것.
 * 와일드카드에 걸린 첫 세그먼트는 seed 로 돌려준다 (/users/42 와 /users/43 을 구분).
 */
export function matchRoute(
  routes: Array<{ path: string; sid: string }>,
  segs: string[],
): { sid: string; seed: string | null } | null {
  let best: { sid: string; seed: string | null; stars: number } | null = null;
  for (const r of routes) {
    const pat = r.path.split('/');
    if (pat.length !== segs.length) continue;
    let stars = 0;
    let seed: string | null = null;
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i] === '*') {
        stars++;
        if (seed === null) seed = segs[i];
      } else if (pat[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok && (best === null || stars < best.stars)) best = { sid: r.sid, seed, stars };
  }
  return best === null ? null : { sid: best.sid, seed: best.seed };
}

/** 실패 모드 설정 — null 이면 해제 */
export async function setMode(kv: KVNamespaceLike, ws: string, status: number | null): Promise<void> {
  const key = routePrefix(ws) + MODE_SUFFIX;
  if (status === null) {
    await kv.delete(key);
    return;
  }
  await kv.put(key, String(status), { metadata: { status }, expirationTtl: WS_TTL_SECONDS });
}

/** 경로 → sid 포인터. 이미 같은 sid 를 가리키면 쓰지 않는다 (쓰기 한도 보호) */
async function putRoute(kv: KVNamespaceLike, ws: string, res: string, sid: string): Promise<void> {
  const key = routePrefix(ws) + res;
  if ((await kv.get(key)) === sid) return;
  await kv.put(key, sid, { metadata: { sid }, expirationTtl: WS_TTL_SECONDS });
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
    fail('Invalid workspace',
      '워크스페이스 ID 는 소문자 영숫자 6~24자입니다.',
      'Workspace IDs are 6-24 lowercase alphanumeric characters.');
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
    fail('Invalid name', '이름은 1~60자 문자열이어야 합니다.', 'Name must be a string of 1-60 characters.');
  }
  if (typeof res !== 'string' || res.length > 80 || !RES_RE.test(res)) {
    fail('Invalid resource',
      "리소스 경로는 영숫자/_/- 세그먼트를 '/' 로 이은 형태입니다 (최대 8단계, 80자). 예: v2/users/detail",
      "Resource paths are alphanumeric/_/- segments joined by '/' (up to 8 segments, 80 chars), e.g. v2/users/detail");
  }
  if (typeof query !== 'string' || query === '') {
    fail('Invalid query', '저장할 스키마 쿼리스트링이 비어 있습니다.', 'The schema query string to save is empty.');
  }
  const canonical = canonicalQuery(query);
  const id = schemaId(res, canonical);
  const key = keyOf(ws, id);

  const existingRaw = await kv.get(key);

  // 해시 충돌 가드 — 같은 ID 인데 내용이 다르면 조용히 덮어쓰지 않고 거부.
  // (content-addressed 라 같은 내용의 재저장은 정상 경로)
  if (existingRaw !== null) {
    try {
      const prev = JSON.parse(existingRaw) as SavedSchema;
      if (prev.query !== canonical || prev.res !== res) {
        fail('ID collision',
          '해시 충돌이 감지되었습니다. 필드를 하나 추가하는 등 스키마를 조금 바꿔 다시 저장해 주세요.',
          'A hash collision was detected. Change the schema slightly (e.g. add a field) and save again.');
      }
      // 중복 쓰기 스킵 — 같은 내용·같은 이름이 최근에 저장돼 있으면 KV 쓰기를 아낀다.
      // (무료 플랜 쓰기 1,000/일 보호. 7일이 지나면 TTL 갱신을 위해 다시 쓴다)
      const age = Date.now() - Date.parse(prev.createdAt);
      if (prev.name === name.trim() && Number.isFinite(age) && age >= 0 && age < REWRITE_AFTER_MS) {
        // 레코드 쓰기는 건너뛰더라도 라우트 포인터는 맞춰둔다 (기능 추가 전 프리셋도 라우트를 얻는다)
        if (ws) await putRoute(kv, ws, res, prev.sid);
        return prev;
      }
    } catch (e) {
      if (e instanceof DslError) throw e;
      // 파싱 불가한 손상 레코드는 새 저장으로 복구
    }
  }

  // 남용 방어: 워크스페이스당 저장 개수 상한 (재저장/이름변경은 기존 키라 허용)
  if (existingRaw === null) {
    const { keys } = await kv.list({ prefix: prefixOf(ws), limit: MAX_PER_WORKSPACE });
    if (keys.length >= MAX_PER_WORKSPACE) {
      fail('Workspace full',
        `워크스페이스당 최대 ${MAX_PER_WORKSPACE}개까지 저장할 수 있습니다. 안 쓰는 항목을 삭제하세요.`,
        `A workspace can hold at most ${MAX_PER_WORKSPACE} schemas. Delete ones you no longer use.`);
    }
  }

  const createdAt = new Date().toISOString();
  const rec: SavedSchema = { id, sid: sidOf(ws, id), ws, name: name.trim(), res, query: canonical, createdAt };
  await kv.put(key, JSON.stringify(rec), {
    metadata: { name: rec.name, res, createdAt },
    ...(ws ? { expirationTtl: WS_TTL_SECONDS } : {}), // 공용 풀은 무기한 (기존 팀 데이터 보존)
  });
  if (ws) await putRoute(kv, ws, res, rec.sid); // 라우트는 워크스페이스 기능 (공용 풀엔 없다)
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
  const raw = await kv.get(key);
  if (raw === null) return false;
  await kv.delete(key);
  // 라우트 포인터도 정리 — 다른 프리셋이 그 경로를 가져갔으면 건드리지 않는다
  if (parsed.ws) {
    try {
      const rec = JSON.parse(raw) as SavedSchema;
      const rkey = routePrefix(parsed.ws) + rec.res;
      if ((await kv.get(rkey)) === sid) await kv.delete(rkey);
    } catch {
      // 손상 레코드면 경로를 알 수 없다 — 포인터는 TTL(180일) 로 만료된다
    }
  }
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
