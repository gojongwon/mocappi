/**
 * _status>=400 기본 실패 바디 + _body 커스텀.
 * 계약: 실패는 메서드·_format 을 가리지 않고 JSON 실패 바디로 나간다.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const Q = 'name=person.fullName&age=int:20~60';
const get = (path: string) => worker.fetch(new Request(BASE + path));

describe('_status>=400 — 기본 실패 바디', () => {
  it('알려진 코드 → {error, status, message}', async () => {
    const res = await get(`/api/users?${Q}&_status=404`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Not Found',
      status: 404,
      message: '요청한 리소스를 찾을 수 없습니다.',
    });
  });

  it('Accept-Language: en → 영어 message', async () => {
    const res = await worker.fetch(new Request(BASE + `/api/users?${Q}&_status=401`, { headers: { 'Accept-Language': 'en' } }));
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('Authentication is required.');
  });

  it('표에 없는 코드 → 범용 실패 바디', async () => {
    const body = (await (await get(`/api/users?${Q}&_status=418`)).json()) as { error: string; status: number };
    expect(body).toEqual({ error: 'Error', status: 418, message: '요청을 처리하지 못했습니다.' });
  });

  it('3xx 는 실패가 아니다 — 데이터 그대로', async () => {
    const a = await (await get(`/api/users?${Q}&_total=2`)).text();
    const b = await get(`/api/users?${Q}&_total=2&_status=302`);
    expect(b.status).toBe(302);
    expect(await b.text()).toBe(a);
  });

  it('메서드·_format 을 가리지 않는다 — DELETE·csv 여도 JSON 실패 바디', async () => {
    const d = await get(`/api/users?${Q}&_method=delete&_status=403`);
    expect(d.status).toBe(403);
    expect(((await d.json()) as { error: string }).error).toBe('Forbidden');

    const c = await get(`/api/users?${Q}&_format=csv&_status=500`);
    expect(c.headers.get('content-type')).toContain('application/json');
    expect(((await c.json()) as { status: number }).status).toBe(500);
  });
});

describe('_body — 실패 바디 커스텀', () => {
  it('_status>=400 이면 _body 를 그대로 반환', async () => {
    const res = await get(`/api/users?${Q}&_status=401&_body=` + encodeURIComponent('{"code":"E_AUTH","message":"토큰 만료"}'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'E_AUTH', message: '토큰 만료' });
  });

  it('객체가 아닌 JSON 도 그대로 (배열·문자열)', async () => {
    const arr = await get(`/api/users?${Q}&_status=422&_body=` + encodeURIComponent('[{"field":"email"}]'));
    expect(await arr.json()).toEqual([{ field: 'email' }]);
  });

  it('_status 가 400 미만이면 400 — 조용히 무시하지 않는다', async () => {
    const res = await get(`/api/users?${Q}&_body=` + encodeURIComponent('{"a":1}'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; hint: string };
    expect(body.field).toBe('_body');
    expect(body.hint).toContain('400');
  });

  it('잘못된 JSON → 400', async () => {
    const res = await get(`/api/users?${Q}&_status=500&_body=` + encodeURIComponent('{nope}'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe('_body');
  });

  it("'&' 포함 → 400 (프리셋 저장 시 쿼리가 쪼개지는 것을 막는다)", async () => {
    const res = await get(`/api/users?${Q}&_status=500&_body=` + encodeURIComponent('{"m":"A & B"}'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { hint: string }).hint).toContain('\\u0026');
  });

  it('2000자 초과 → 400', async () => {
    const big = JSON.stringify({ m: 'x'.repeat(2100) });
    const res = await get(`/api/users?${Q}&_status=500&_body=` + encodeURIComponent(big));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { hint: string }).hint).toContain('2000');
  });
});
