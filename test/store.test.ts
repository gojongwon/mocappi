import { describe, expect, it } from 'vitest';
import { MAX_PER_WORKSPACE, canonicalQuery, parseSid, schemaId, type KVNamespaceLike } from '../src/store';
import { DslError } from '../src/registry';
import worker from '../src/index';

/** 인메모리 KV 목 */
class MemKV implements KVNamespaceLike {
  store = new Map<string, { value: string; metadata?: unknown }>();
  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.store.set(key, { value, metadata: options?.metadata });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';
    return {
      keys: [...this.store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata })),
    };
  }
}

const BASE = 'https://mock.test';
const env = () => ({ SCHEMAS: new MemKV() });
const QUERY = 'name=person.fullName&id=uuid&age=int:20~60&_total=50';
const TESTWS = 'testws000001'; // 저장은 워크스페이스 전용

async function save(e: { SCHEMAS: MemKV }, name = '기술자 목록', res = 'users', query = QUERY, ws: string | null = TESTWS) {
  const r = await worker.fetch(
    new Request(BASE + '/schema/save', { method: 'POST', body: JSON.stringify({ name, res, query, ws: ws ?? undefined }) }),
    e,
  );
  return { status: r.status, body: (await r.json()) as { id: string; sid: string; apiUrl: string; query: string } };
}

describe('content-addressed ID', () => {
  it('필드 순서가 달라도 같은 내용이면 같은 ID', () => {
    const a = canonicalQuery('id=uuid&name=person.fullName&_total=50');
    const b = canonicalQuery('_total=50&name=person.fullName&id=uuid');
    expect(a).toBe(b);
    expect(schemaId('users', a)).toBe(schemaId('users', b));
  });

  it('내용이 다르면 다른 ID, 리소스명이 달라도 다른 ID', () => {
    const a = canonicalQuery('id=uuid');
    const b = canonicalQuery('id=uuid&x=int:1~5');
    expect(schemaId('users', a)).not.toBe(schemaId('users', b));
    expect(schemaId('users', a)).not.toBe(schemaId('orders', a));
  });

  it('잘못된 스키마는 저장 불가 (검증 통과 필수)', () => {
    expect(() => canonicalQuery('age=int:20-60')).toThrow(DslError);
  });
});

describe('저장/조회/목록/삭제 라우트', () => {
  it('save → 멱등 (같은 내용 = 같은 ID), get/list 반영', async () => {
    const e = env();
    const first = await save(e);
    expect(first.status).toBe(200);
    expect(first.body.apiUrl).toBe(`/api/users?_s=${TESTWS}.${first.body.id}`);

    const again = await save(e, '다른 이름, 같은 내용');
    expect(again.body.id).toBe(first.body.id); // content-addressed

    const list = (await (await worker.fetch(new Request(`${BASE}/schema/saved?ws=${TESTWS}`), e)).json()) as { items: Array<{ id: string; name: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('다른 이름, 같은 내용');

    const got = (await (await worker.fetch(new Request(`${BASE}/schema/saved/${first.body.sid}`), e)).json()) as { query: string };
    expect(got.query).toBe(canonicalQuery(QUERY));
  });

  it('공용 풀 저장은 차단 (조회 전용)', async () => {
    const e = env();
    const r = await save(e, '공용 시도', 'users', QUERY, null);
    expect(r.status).toBe(400);
    expect((r.body as unknown as { error: string }).error).toBe('Workspace required');
  });

  it('삭제 후 _s 호출 → 404', async () => {
    const e = env();
    const { body } = await save(e);
    const del = await worker.fetch(new Request(`${BASE}/schema/saved/${body.sid}`, { method: 'DELETE' }), e);
    expect(del.status).toBe(200);
    const res = await worker.fetch(new Request(`${BASE}/api/users?_s=${body.sid}`), e);
    expect(res.status).toBe(404);
  });

  it('저장 검증 실패 → 400 + 힌트', async () => {
    const e = env();
    expect((await save(e, '이름', 'users', 'age=int:20-60')).status).toBe(400);
    expect((await save(e, '', 'users')).status).toBe(400);
    expect((await save(e, '이름', '한글리소스')).status).toBe(400);
  });

  it('KV 미설정 → 501 + 안내 (저장/목록/_s 모두)', async () => {
    for (const req of [
      new Request(BASE + '/schema/save', { method: 'POST', body: '{}' }),
      new Request(BASE + '/schema/saved'),
      new Request(BASE + '/api/users?_s=abcd1234'),
    ]) {
      const res = await worker.fetch(req); // env 없음
      expect(res.status).toBe(501);
      expect(((await res.json()) as { hint: string }).hint).toContain('KV');
    }
  });
});

describe('워크스페이스', () => {
  const WS = 'x7kp2m9qab3z';

  it('parseSid — 복합/단일/불량 형식', () => {
    expect(parseSid('18l8dn41ai')).toEqual({ ws: null, id: '18l8dn41ai' });
    expect(parseSid(`${WS}.18l8dn41ai`)).toEqual({ ws: WS, id: '18l8dn41ai' });
    expect(parseSid('UPPER.18l8dn41ai')).toBeNull();
    expect(parseSid('a.b')).toBeNull();
    expect(parseSid('')).toBeNull();
  });

  it('격리 — 워크스페이스 저장물은 공용/다른 워크스페이스 목록에 안 보임', async () => {
    const e = env();
    const saved = await save(e, '내 프리셋', 'users', QUERY, WS);
    expect(saved.status).toBe(200);
    expect(saved.body.sid).toBe(`${WS}.${saved.body.id}`);
    expect(saved.body.apiUrl).toBe(`/api/users?_s=${WS}.${saved.body.id}`);

    const listOf = async (q: string) =>
      ((await (await worker.fetch(new Request(BASE + '/schema/saved' + q), e)).json()) as { items: unknown[] }).items;
    expect(await listOf('?ws=' + WS)).toHaveLength(1);
    expect(await listOf('')).toHaveLength(0); // 공용 풀에는 없음
    expect(await listOf('?ws=zzzzzz999999')).toHaveLength(0); // 다른 워크스페이스에도 없음
  });

  it('복합 sid 로 _s 호출 == 전개 URL (바이트 동일), 레거시 공용 sid 도 계속 동작', async () => {
    const e = env();
    const inWs = await save(e, 'ws', 'users', QUERY, WS);
    // v0.6 이전에 공용 풀에 저장된 레거시 레코드 직접 시딩 (조회 호환 확인)
    const canonical = canonicalQuery(QUERY);
    const legacyId = schemaId('users', canonical);
    await e.SCHEMAS.put(
      's:' + legacyId,
      JSON.stringify({ id: legacyId, name: '레거시', res: 'users', query: canonical, createdAt: '2026-01-01T00:00:00Z' }),
      { metadata: { name: '레거시', res: 'users', createdAt: '2026-01-01T00:00:00Z' } },
    );
    const short1 = await (await worker.fetch(new Request(`${BASE}/api/users?_s=${inWs.body.sid}`), e)).text();
    const short2 = await (await worker.fetch(new Request(`${BASE}/api/users?_s=${legacyId}`), e)).text();
    const long = await (await worker.fetch(new Request(`${BASE}/api/users?${QUERY}`), e)).text();
    expect(short1).toBe(long);
    expect(short2).toBe(long);
    // 공용 풀 목록 조회도 계속 동작 (조회 전용)
    const pub = (await (await worker.fetch(new Request(BASE + '/schema/saved'), e)).json()) as { items: unknown[] };
    expect(pub.items).toHaveLength(1);
  });

  it('잘못된 ws → 400', async () => {
    const e = env();
    expect((await save(e, 'n', 'users', QUERY, 'BAD_WS!')).status).toBe(400);
    const res = await worker.fetch(new Request(BASE + '/schema/saved?ws=BAD_WS!'), e);
    expect(res.status).toBe(400);
  });

  it('워크스페이스 저장 한도 초과 → 400', async () => {
    const e = env();
    for (let i = 0; i < MAX_PER_WORKSPACE; i++) {
      const r = await save(e, 'p' + i, 'users', `id=uuid&n=const:v${i}`, WS);
      expect(r.status).toBe(200);
    }
    const over = await save(e, '초과', 'users', 'id=uuid&n=const:overflow', WS);
    expect(over.status).toBe(400);
    // 기존 항목 재저장(멱등)은 한도와 무관하게 허용
    const resave = await save(e, '이름만 변경', 'users', 'id=uuid&n=const:v0', WS);
    expect(resave.status).toBe(200);
  });
});

describe('_s 호출의 결정론', () => {
  it('_s URL 응답 == 전개된 URL 응답 (바이트 동일)', async () => {
    const e = env();
    const { body } = await save(e);
    const short = await (await worker.fetch(new Request(`${BASE}/api/users?_s=${body.sid}`), e)).text();
    const long = await (await worker.fetch(new Request(`${BASE}/api/users?${QUERY}`), e)).text();
    expect(short).toBe(long);
  });

  it('오버라이드 — _s + _page/_limit 이 요청 우선으로 적용', async () => {
    const e = env();
    const { body } = await save(e);
    const short = (await (
      await worker.fetch(new Request(`${BASE}/api/users?_s=${body.sid}&_page=2&_limit=5`), e)
    ).json()) as { page: number; limit: number; data: unknown[] };
    expect(short.page).toBe(2);
    expect(short.limit).toBe(5);
    // 항목별 시드 안정성도 그대로: 전개 URL 과 교차 검증
    const long = (await (
      await worker.fetch(new Request(`${BASE}/api/users?${QUERY}&_page=2&_limit=5`), e)
    ).json()) as { data: unknown[] };
    expect(JSON.stringify(short.data)).toBe(JSON.stringify(long.data));
  });

  it('필드 오버라이드 — 같은 필드는 요청 값으로 대체', async () => {
    const e = env();
    const { body } = await save(e);
    const res = (await (
      await worker.fetch(new Request(`${BASE}/api/users?_s=${body.sid}&age=const:fixed&_limit=1`), e)
    ).json()) as { data: Array<{ age: string }> };
    expect(res.data[0].age).toBe('fixed');
  });

  it('존재하지 않는 ID → 404 + 힌트', async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/users?_s=zzzz9999`), env());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { field: string }).field).toBe('_s');
  });
});
