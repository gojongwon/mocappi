/**
 * 라우트 모드 — /w/<ws>/<경로>. 쿼리스트링 없이 워크스페이스 프리셋으로 해석한다.
 * 목적: 앱에서 베이스 URL 만 바꾸면 호출부를 고치지 않고 목이 응답한다.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { matchRoute, saveSchema, setMode, deleteSchema, listRoutes, type KVNamespaceLike } from '../src/store';

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

const WS = 'routews0001';
const BASE = 'https://mock.test';

/** 프리셋이 준비된 워크스페이스 */
async function seed() {
  const kv = new MemKV();
  await saveSchema(kv, WS, '사용자 목록', 'users', 'id=uuid&name=person.fullName&_total=30');
  await saveSchema(kv, WS, '사용자 상세', 'users/*', 'id=uuid&name=person.fullName&_wrap=one');
  return kv;
}
const call = (kv: KVNamespaceLike, path: string, init?: RequestInit) =>
  worker.fetch(new Request(BASE + path, init), { SCHEMAS: kv });

// ---------------------------------------------------------------------------
// matchRoute 는 순수 함수 — 우선순위를 직접 고정한다
// ---------------------------------------------------------------------------
describe('matchRoute 우선순위', () => {
  const routes = [
    { path: 'users', sid: 'A' },
    { path: 'users/*', sid: 'B' },
    { path: 'users/me', sid: 'C' },
    { path: 'users/*/orders', sid: 'D' },
    { path: '*/*', sid: 'E' },
  ];

  it('정확 일치가 와일드카드보다 우선', () => {
    expect(matchRoute(routes, ['users', 'me'])?.sid).toBe('C');
  });

  it('정확 일치가 없으면 와일드카드', () => {
    const hit = matchRoute(routes, ['users', '42']);
    expect(hit?.sid).toBe('B');
    expect(hit?.seed).toBe('42'); // 걸린 세그먼트를 시드로
  });

  it('* 가 적은 쪽이 우선', () => {
    expect(matchRoute(routes, ['posts', '7'])?.sid).toBe('E'); // users/* 는 안 맞음
    expect(matchRoute(routes, ['users', '7', 'orders'])?.sid).toBe('D');
  });

  it('세그먼트 개수가 다르면 매치 없음', () => {
    expect(matchRoute(routes, ['users', '42', 'orders', '9'])).toBeNull();
    expect(matchRoute(routes, [])).toBeNull();
  });

  it('빈 라우트 표 → null', () => {
    expect(matchRoute([], ['users'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('/w/<ws>/<경로>', () => {
  it('쿼리 없이 목록 응답 — 프리셋의 스키마가 적용된다', async () => {
    const res = await call(await seed(), `/w/${WS}/users`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; name: string }>; total: number };
    expect(body.total).toBe(30);
    expect(body.data[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('와일드카드 상세 — 세그먼트가 시드로 들어가 id 별로 다른 데이터', async () => {
    const kv = await seed();
    const a = await (await call(kv, `/w/${WS}/users/42`)).text();
    const b = await (await call(kv, `/w/${WS}/users/42`)).text();
    const c = await (await call(kv, `/w/${WS}/users/43`)).text();
    expect(a).toBe(b); // 같은 경로 → 같은 데이터
    expect(c).not.toBe(a); // id 가 다르면 데이터도 다르다
    expect(Array.isArray(JSON.parse(a))).toBe(false); // _wrap=one 이 적용돼 단일 객체
  });

  it('POST — /api 와 동일하게 생성 아이템 + 201', async () => {
    const res = await call(await seed(), `/w/${WS}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '고종원' }),
    });
    expect(res.status).toBe(201);
    const item = (await res.json()) as Record<string, unknown>;
    expect(item.name).toBe('고종원'); // 보낸 값 에코
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/); // 서버 할당 필드
  });

  it('DELETE → 204', async () => {
    expect((await call(await seed(), `/w/${WS}/users`, { method: 'DELETE' })).status).toBe(204);
  });

  it('요청 쿼리가 프리셋보다 우선 — 앱이 ?_page=2 를 붙일 수 있다', async () => {
    const res = await call(await seed(), `/w/${WS}/users?_limit=3&_page=2`);
    const body = (await res.json()) as { data: unknown[]; page: number; limit: number };
    expect(body.data).toHaveLength(3);
    expect(body.page).toBe(2);
  });

  it('미등록 경로 → 404 + 등록된 경로 목록 힌트', async () => {
    const res = await call(await seed(), `/w/${WS}/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe('Unknown route');
    expect(body.hint).toContain('users');
  });

  it('빈 워크스페이스 → 404 + 등록된 경로 없음 안내', async () => {
    const res = await call(new MemKV(), `/w/emptyws0001/users`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { hint: string }).hint).toContain('없습니다');
  });

  it('저장소 미설정 → 501', async () => {
    const res = await worker.fetch(new Request(`${BASE}/w/${WS}/users`));
    expect(res.status).toBe(501);
  });

  it('지원하지 않는 메서드 → 405', async () => {
    expect((await call(await seed(), `/w/${WS}/users`, { method: 'LOCK' })).status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
describe('워크스페이스 실패 모드', () => {
  it('모드를 켜면 모든 라우트가 에러 본문으로 응답 — 앱 코드 변경 0', async () => {
    const kv = await seed();
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(200);

    await setMode(kv, WS, 503);
    const res = await call(kv, `/w/${WS}/users`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty('data'); // 성공 본문이 아니다

    // 와일드카드 라우트·쓰기에도 똑같이 적용
    expect((await call(kv, `/w/${WS}/users/42`)).status).toBe(503);
    expect((await call(kv, `/w/${WS}/users`, { method: 'POST' })).status).toBe(503);
  });

  it('모드 해제하면 정상 복귀', async () => {
    const kv = await seed();
    await setMode(kv, WS, 422);
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(422);
    await setMode(kv, WS, null);
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(200);
  });

  it('요청이 _status 를 지정하면 모드는 개입하지 않는다', async () => {
    const kv = await seed();
    await setMode(kv, WS, 500);
    expect((await call(kv, `/w/${WS}/users?_status=200`)).status).toBe(200);
  });

  it('POST /schema/mode — 400~599 만 허용, null·200 은 해제', async () => {
    const kv = await seed();
    const post = (body: unknown) =>
      worker.fetch(
        new Request(`${BASE}/schema/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        { SCHEMAS: kv },
      );
    expect((await post({ ws: WS, status: 422 })).status).toBe(200);
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(422);

    expect((await post({ ws: WS, status: null })).status).toBe(200);
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(200);

    expect((await post({ ws: WS, status: 200 })).status).toBe(200); // 200 도 해제
    expect((await post({ ws: WS, status: 302 })).status).toBe(400); // 실패 코드 아님
    expect((await post({ ws: 'bad' })).status).toBe(400); // 워크스페이스 형식 오류
    expect((await worker.fetch(new Request(`${BASE}/schema/mode`), { SCHEMAS: kv })).status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
describe('라우트 포인터 수명', () => {
  it('저장하면 라우트가 등록되고, 삭제하면 함께 사라진다', async () => {
    const kv = new MemKV();
    const rec = await saveSchema(kv, WS, '사용자', 'users', 'id=uuid');
    expect((await listRoutes(kv, WS)).routes).toEqual([{ path: 'users', sid: rec.sid }]);

    expect(await deleteSchema(kv, rec.sid)).toBe(true);
    expect((await listRoutes(kv, WS)).routes).toEqual([]);
    expect((await call(kv, `/w/${WS}/users`)).status).toBe(404);
  });

  it('같은 경로를 다른 스키마로 저장하면 라우트가 새 sid 를 가리킨다', async () => {
    const kv = new MemKV();
    const a = await saveSchema(kv, WS, 'v1', 'users', 'id=uuid');
    const b = await saveSchema(kv, WS, 'v2', 'users', 'id=uuid&email=internet.email');
    expect(a.sid).not.toBe(b.sid);
    expect((await listRoutes(kv, WS)).routes).toEqual([{ path: 'users', sid: b.sid }]);
  });

  it('공용 풀(ws 없음) 저장은 라우트를 만들지 않는다', async () => {
    const kv = new MemKV();
    await saveSchema(kv, null, '공용', 'users', 'id=uuid');
    expect((await listRoutes(kv, WS)).routes).toEqual([]);
  });

  it('라우트 포인터가 프리셋 목록을 오염시키지 않는다', async () => {
    const kv = new MemKV();
    await saveSchema(kv, WS, '사용자', 'users', 'id=uuid');
    const res = await worker.fetch(new Request(`${BASE}/schema/saved?ws=${WS}`), { SCHEMAS: kv });
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });
});
