import { describe, expect, it } from 'vitest';
import { canonicalQuery, schemaId, type KVNamespaceLike } from '../src/store';
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

async function save(e: { SCHEMAS: MemKV }, name = '기술자 목록', res = 'users', query = QUERY) {
  const r = await worker.fetch(
    new Request(BASE + '/schema/save', { method: 'POST', body: JSON.stringify({ name, res, query }) }),
    e,
  );
  return { status: r.status, body: (await r.json()) as { id: string; apiUrl: string; query: string } };
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
    expect(first.body.apiUrl).toBe(`/api/users?_s=${first.body.id}`);

    const again = await save(e, '다른 이름, 같은 내용');
    expect(again.body.id).toBe(first.body.id); // content-addressed

    const list = (await (await worker.fetch(new Request(BASE + '/schema/saved'), e)).json()) as { items: Array<{ id: string; name: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('다른 이름, 같은 내용');

    const got = (await (await worker.fetch(new Request(`${BASE}/schema/saved/${first.body.id}`), e)).json()) as { query: string };
    expect(got.query).toBe(canonicalQuery(QUERY));
  });

  it('삭제 후 _s 호출 → 404', async () => {
    const e = env();
    const { body } = await save(e);
    const del = await worker.fetch(new Request(`${BASE}/schema/saved/${body.id}`, { method: 'DELETE' }), e);
    expect(del.status).toBe(200);
    const res = await worker.fetch(new Request(`${BASE}/api/users?_s=${body.id}`), e);
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

describe('_s 호출의 결정론', () => {
  it('_s URL 응답 == 전개된 URL 응답 (바이트 동일)', async () => {
    const e = env();
    const { body } = await save(e);
    const short = await (await worker.fetch(new Request(`${BASE}/api/users?_s=${body.id}`), e)).text();
    const long = await (await worker.fetch(new Request(`${BASE}/api/users?${QUERY}`), e)).text();
    expect(short).toBe(long);
  });

  it('오버라이드 — _s + _page/_limit 이 요청 우선으로 적용', async () => {
    const e = env();
    const { body } = await save(e);
    const short = (await (
      await worker.fetch(new Request(`${BASE}/api/users?_s=${body.id}&_page=2&_limit=5`), e)
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
      await worker.fetch(new Request(`${BASE}/api/users?_s=${body.id}&age=const:fixed&_limit=1`), e)
    ).json()) as { data: Array<{ age: string }> };
    expect(res.data[0].age).toBe('fixed');
  });

  it('존재하지 않는 ID → 404 + 힌트', async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/users?_s=zzzz9999`), env());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { field: string }).field).toBe('_s');
  });
});
