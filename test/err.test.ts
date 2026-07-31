/**
 * 에러 본문 — 상태코드만으로 판단한다.
 *
 *   _status >= 400 + 필드 없음  → 상태코드에 맞는 기본 에러 본문
 *   _status >= 400 + 필드 있음  → 그 필드가 응답 (에러 본문 커스텀 = 필드 정의)
 *
 * 별도 토글 파라미터가 없다.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const get = (path: string) => worker.fetch(new Request(BASE + path));
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('기본 에러 본문 (필드 없음)', () => {
  it('_status 만으로 동작 — 필드가 필요 없다', async () => {
    const res = await get('/api/users?_status=422');
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
      const res = await get(`/api/users?_status=${status}`);
      expect(res.status).toBe(Number(status));
      expect((await body(res)).code, status).toBe(code);
    }
  });

  it('매핑에 없는 4xx → ERROR, 5xx → INTERNAL_ERROR + traceId', async () => {
    expect((await body(await get('/api/users?_status=418'))).code).toBe('ERROR');
    const five = await body(await get('/api/users?_status=503'));
    expect(five.code).toBe('INTERNAL_ERROR');
    expect(five.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('4xx 에는 traceId 가 없다', async () => {
    expect(await body(await get('/api/users?_status=404'))).not.toHaveProperty('traceId');
  });

  it('traceId 는 결정론 — 같은 요청이면 같은 값', async () => {
    const a = await (await get('/api/users?_status=500')).text();
    const b = await (await get('/api/users?_status=500')).text();
    expect(a).toBe(b);
    const c = await (await get('/api/users?_total=7&_status=500')).text();
    expect(c).not.toBe(a);
  });

  it('_delay 는 걸린다', async () => {
    const t0 = Date.now();
    await get('/api/users?_status=500&_delay=120');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('_format=csv 는 무시하고 JSON — 에러 본문은 표가 아니다', async () => {
    const res = await get('/api/users?_status=500&_format=csv');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await body(res)).code).toBe('INTERNAL_ERROR');
  });

  it('Accept-Language: en → 영어 메시지', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/users?_status=422`, { headers: { 'accept-language': 'en-US' } }),
    );
    const b = await body(res);
    expect(b.message).toBe('The request could not be processed.');
    expect((b.errors as { email: string }).email).toBe('This email is already taken.');
  });

  it('쓰기에서도 동작 — 요청 body 를 에코하지 않는다', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/users?_status=422`, {
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
});

describe('필드가 있으면 필드가 이긴다', () => {
  it('에러 본문 커스텀 = code·message 를 필드로 정의', async () => {
    const res = await get('/api/users?code=const:MY_CODE&message=const:직접 정의&_wrap=one&_status=422');
    expect(res.status).toBe(422);
    expect(await body(res)).toEqual({ code: 'MY_CODE', message: '직접 정의' });
  });

  it('성공 스키마 + 4xx → 본문은 성공 그대로 (기존 동작 유지)', async () => {
    const a = await (await get('/api/users?id=uuid&_total=5')).text();
    const b = await get('/api/users?id=uuid&_total=5&_status=500');
    expect(b.status).toBe(500);
    expect(await b.text()).toBe(a); // res.ok 안 보고 파싱하는 코드를 잡는 용도
  });
});

describe('2xx 는 여전히 필드가 필수', () => {
  it('필드 없이 200 → 400 No fields defined', async () => {
    const res = await get('/api/users');
    expect(res.status).toBe(400);
    expect(((await body(res)) as { error: string }).error).toBe('No fields defined');
  });

  it('필드 없이 _status=201 → 400 (2xx 는 스키마가 필요하다)', async () => {
    expect((await get('/api/users?_status=201')).status).toBe(400);
  });
});
