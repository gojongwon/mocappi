/**
 * _err=1 — 스키마 대신 상태코드에 맞는 에러 본문.
 * 읽기·쓰기 공통이고, 필드가 없어도 동작한다 (?_status=422&_err=1 만으로).
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const get = (path: string) => worker.fetch(new Request(BASE + path));
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('_err 코드 매핑', () => {
  it('필드 없이 _status + _err 만으로 동작', async () => {
    const res = await get('/api/users?_status=422&_err=1');
    expect(res.status).toBe(422);
    expect(await body(res)).toEqual({
      code: 'VALIDATION_FAILED',
      message: '요청을 처리할 수 없습니다.',
      errors: { email: '이미 사용 중인 이메일입니다.' },
    });
  });

  it('4xx 매핑 — 400/401/403/404/409/429', async () => {
    const want: Record<number, string> = {
      400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'TOO_MANY_REQUESTS',
    };
    for (const [status, code] of Object.entries(want)) {
      const res = await get(`/api/users?_status=${status}&_err=1`);
      expect(res.status).toBe(Number(status));
      expect((await body(res)).code, status).toBe(code);
    }
  });

  it('매핑에 없는 4xx → ERROR, 5xx → INTERNAL_ERROR + traceId', async () => {
    expect((await body(await get('/api/users?_status=418&_err=1'))).code).toBe('ERROR');
    const five = await body(await get('/api/users?_status=503&_err=1'));
    expect(five.code).toBe('INTERNAL_ERROR');
    expect(five.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('4xx 에는 traceId 가 없다', async () => {
    expect(await body(await get('/api/users?_status=404&_err=1'))).not.toHaveProperty('traceId');
  });

  it('traceId 는 결정론 — 같은 요청이면 같은 값, 스키마가 다르면 다른 값', async () => {
    const a = await (await get('/api/users?id=uuid&_status=500&_err=1')).text();
    const b = await (await get('/api/users?id=uuid&_status=500&_err=1')).text();
    expect(a).toBe(b);
    const c = await (await get('/api/orders?id=uuid&_total=7&_status=500&_err=1')).text();
    expect(c).not.toBe(a);
  });
});

describe('_err 검증', () => {
  it('_status 가 4xx·5xx 가 아니면 400 + 힌트', async () => {
    const res = await get('/api/users?id=uuid&_err=1');
    expect(res.status).toBe(400);
    expect(((await body(res)) as { hint: string }).hint).toContain('4xx');
  });

  it("_err 은 '1' 만 받는다", async () => {
    expect((await get('/api/users?id=uuid&_status=500&_err=0')).status).toBe(400);
    expect((await get('/api/users?id=uuid&_status=500&_err=true')).status).toBe(400);
  });
});

describe('_err 은 다른 동작과 어긋나지 않는다', () => {
  it('스키마 필드가 있어도 에러 본문이 이긴다 — 필드는 응답에 없다', async () => {
    const b = await body(await get('/api/users?id=uuid&name=person.fullName&_status=422&_err=1'));
    expect(b).not.toHaveProperty('id');
    expect(b).not.toHaveProperty('name');
    expect(b.code).toBe('VALIDATION_FAILED');
  });

  it('쓰기에서도 동작 — 요청 body 를 에코하지 않는다', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/users?id=uuid&_status=422&_err=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.c', password: '1234' }),
      }),
    );
    expect(res.status).toBe(422);
    const b = await body(res);
    expect(b).not.toHaveProperty('password');
    expect(b.code).toBe('VALIDATION_FAILED');
  });

  it('_format=csv 는 무시하고 JSON — 에러 본문은 표가 아니다', async () => {
    const res = await get('/api/users?id=uuid&_status=500&_err=1&_format=csv');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await body(res)).code).toBe('INTERNAL_ERROR');
  });

  it('_delay 는 걸린다', async () => {
    const t0 = Date.now();
    await get('/api/users?_status=500&_err=1&_delay=120');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('Accept-Language: en → 영어 메시지', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/users?_status=422&_err=1`, { headers: { 'accept-language': 'en-US' } }),
    );
    const b = await body(res);
    expect(b.message).toBe('The request could not be processed.');
    expect((b.errors as { email: string }).email).toBe('This email is already taken.');
  });

  it('_err 없이 _status 만 → 기존 동작 유지 (본문은 성공 그대로)', async () => {
    const a = await (await get('/api/users?id=uuid&_total=5')).text();
    const b = await get('/api/users?id=uuid&_total=5&_status=500');
    expect(b.status).toBe(500);
    expect(await b.text()).toBe(a);
  });
});
