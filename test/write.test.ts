/**
 * 무상태 쓰기 목 — POST/PUT/PATCH/DELETE.
 * 핵심 계약 3개:
 *  1) 보낸 필드는 에코, 안 보낸 선언 필드는 생성기가 채운다
 *  2) 같은 요청(URL+body) → 같은 응답. body 가 다르면 서버 할당 필드도 다르다
 *  3) 상태를 저장하지 않는다 — POST 한 항목은 GET 목록에 없다
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const SCHEMA = 'id=uuid&name=person.fullName&createdAt=date.recent';
const URL_ = `${BASE}/api/users?${SCHEMA}`;

const send = (method: string, url: string, body?: unknown) =>
  worker.fetch(
    new Request(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

describe('POST — 생성 목', () => {
  it('201 + 보낸 필드 에코 + 서버 할당 필드 채움', async () => {
    const res = await send('POST', URL_, { name: '고종원', age: 31 });
    expect(res.status).toBe(201);
    const item = (await res.json()) as Record<string, unknown>;
    expect(item.name).toBe('고종원'); // 클라가 보낸 값 그대로
    expect(item.age).toBe(31); // 스키마에 없어도 통과
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/); // 선언됐지만 안 보냄 → 생성기가 채움
    expect(typeof item.createdAt).toBe('string');
  });

  it('같은 body 2회 → 응답 바이트 동일 / body 가 다르면 id 도 다르다', async () => {
    const a = await (await send('POST', URL_, { name: 'A' })).text();
    const b = await (await send('POST', URL_, { name: 'A' })).text();
    expect(a).toBe(b);
    const other = (await (await send('POST', URL_, { name: 'B' })).json()) as { id: string };
    expect(other.id).not.toBe((JSON.parse(a) as { id: string }).id);
  });

  it('Location 을 GET 하면 POST 응답과 같은 아이템', async () => {
    const res = await send('POST', URL_, { name: '고종원' });
    const loc = res.headers.get('Location');
    expect(loc).toBeTruthy();
    const created = (await res.json()) as Record<string, unknown>;
    const fetched = (await (await worker.fetch(new Request(loc!))).json()) as Record<string, unknown>;
    // body 로 덮어쓴 필드를 뺀 서버 할당 필드가 일치해야 한다
    expect(fetched.id).toBe(created.id);
    expect(fetched.createdAt).toBe(created.createdAt);
  });

  it('body 없이 POST 해도 201 + 전체 생성 아이템', async () => {
    const res = await send('POST', URL_);
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toHaveProperty('name');
  });
});

describe('PUT / PATCH / DELETE', () => {
  it('PUT → 200, 멱등 (같은 요청 2회 동일 응답)', async () => {
    const a = await send('PUT', URL_, { name: '수정' });
    expect(a.status).toBe(200);
    expect(a.headers.get('Location')).toBeNull(); // 생성이 아니므로 Location 없음
    expect(await a.text()).toBe(await (await send('PUT', URL_, { name: '수정' })).text());
  });

  it('PATCH → 200 (이 목에서는 PUT 과 동일 — 생성+덮어쓰기가 곧 병합)', async () => {
    const res = await send('PATCH', URL_, { name: '일부수정' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('일부수정');
  });

  it('DELETE → 204 + 빈 본문', async () => {
    const res = await send('DELETE', URL_);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

describe('에러·지연 경로 (쓰기 실패 UI 테스트용)', () => {
  it('_status 가 있으면 그 코드가 우선 — 201 대신 422', async () => {
    const res = await send('POST', `${URL_}&_status=422`, { name: 'x' });
    expect(res.status).toBe(422);
    expect(res.headers.get('Location')).toBeNull(); // 실패엔 Location 없음
  });

  it('에러 응답에는 요청 body 를 에코하지 않는다 — 422 검증 에러 본문이 쿼리 그대로', async () => {
    const url = `${BASE}/api/users?errors.email=const:이미 사용중&message=const:검증 실패&_status=422`;
    const res = await send('POST', url, { email: 'a@b.c', name: '고종원', password: '1234' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ errors: { email: '이미 사용중' }, message: '검증 실패' });
    expect(body).not.toHaveProperty('password'); // 비밀번호가 에러 응답에 새지 않는다
  });

  it('2xx 는 여전히 에코한다 — 성공 응답은 보낸 값이 돌아와야 한다', async () => {
    const res = await send('POST', URL_, { name: '고종원' });
    expect(((await res.json()) as { name: string }).name).toBe('고종원');
  });

  it('_status=204 → 본문 없이 204 (Response 생성자 TypeError 방지)', async () => {
    const res = await send('POST', `${URL_}&_status=204`, { name: 'x' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('_delay 가 쓰기에도 걸린다', async () => {
    const t0 = Date.now();
    await send('POST', `${URL_}&_delay=120`, { name: 'x' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('깨진 JSON → 400, 객체가 아닌 body → 400', async () => {
    const bad = await worker.fetch(new Request(URL_, { method: 'POST', body: '{oops' }));
    expect(bad.status).toBe(400);
    const arr = await send('POST', URL_, [1, 2, 3]);
    expect(arr.status).toBe(400);
    expect(((await arr.json()) as { hint: string }).hint).toContain('객체');
  });

  it('64KB 초과 body → 413', async () => {
    const res = await send('POST', URL_, { blob: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
  });

  it('DSL 에러는 쓰기에서도 400 — 스키마 검증을 GET 과 공유', async () => {
    const res = await send('POST', `${BASE}/api/users?age=int:20-60`, { age: 30 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe('age');
  });
});

describe('무상태 — 이 구현의 한계를 명시적으로 고정', () => {
  it('POST 한 항목은 GET 목록에 나타나지 않는다', async () => {
    await send('POST', URL_, { name: '절대없는이름' });
    const list = (await (await worker.fetch(new Request(`${URL_}&_limit=50`))).json()) as {
      data: Array<{ name: string }>;
    };
    expect(list.data.some((d) => d.name === '절대없는이름')).toBe(false);
  });
});

describe('CORS — 브라우저에서 실제로 쓸 수 있는지', () => {
  it('프리플라이트에 PUT/PATCH 허용 + Location 노출', async () => {
    const res = await worker.fetch(new Request(URL_, { method: 'OPTIONS' }));
    const allow = res.headers.get('Access-Control-Allow-Methods') ?? '';
    expect(allow).toContain('PUT');
    expect(allow).toContain('PATCH');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Location');
  });
});
