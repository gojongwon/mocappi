/**
 * _method — 메서드별 기본 응답.
 * 핵심 계약: 메서드는 응답 '모양'만 바꾼다. 같은 필드면 데이터는 그대로다 (시드 제외).
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const Q = 'name=person.fullName&age=int:20~60';
const get = (path: string) => worker.fetch(new Request(BASE + path));
const call = (method: string, path: string) => worker.fetch(new Request(BASE + path, { method }));

describe('_method — 메서드별 기본 응답', () => {
  it('실제 verb 폴백 — GET 목록 / POST 201 단건 / PUT·PATCH 200 단건 / DELETE 204 무본문', async () => {
    const g = await call('GET', `/api/users?${Q}&_total=3`);
    expect(g.status).toBe(200);
    expect(((await g.json()) as { data: unknown[] }).data).toHaveLength(3);

    const p = await call('POST', `/api/users?${Q}`);
    expect(p.status).toBe(201);
    expect(Object.keys((await p.json()) as object).sort()).toEqual(['age', 'name']);

    for (const m of ['PUT', 'PATCH']) {
      const res = await call(m, `/api/users?${Q}`);
      expect(res.status, m).toBe(200);
      expect(Array.isArray(await res.json()), m).toBe(false);
    }

    const d = await call('DELETE', `/api/users?${Q}`);
    expect(d.status).toBe(204);
    expect(await d.text()).toBe('');
  });

  it('_method 가 실제 verb 를 이긴다 — 평범한 GET 으로도 POST 응답', async () => {
    const res = await get(`/api/users?${Q}&_method=post`);
    expect(res.status).toBe(201);
    const viaVerb = await call('POST', `/api/users?${Q}`);
    expect(await res.text()).toBe(await viaVerb.text());
  });

  it('_method=get 이면 POST 로 불러도 목록 200', async () => {
    const res = await call('POST', `/api/users?${Q}&_method=get&_total=2`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(2);
  });

  it('POST 단건 == 같은 스키마 GET 목록의 0번 아이템 (바이트 동일)', async () => {
    const one = await (await get(`/api/users?${Q}&_method=post`)).text();
    const wrapOne = await (await get(`/api/users?${Q}&_wrap=one`)).text();
    expect(one).toBe(wrapOne);
    const list = (await (await get(`/api/users?${Q}`)).json()) as { data: unknown[] };
    expect(JSON.stringify(list.data[0], null, 2)).toBe(one);
  });

  it('_status 명시가 메서드 기본값을 이긴다', async () => {
    expect((await get(`/api/users?${Q}&_method=post&_status=200`)).status).toBe(200);
    expect((await get(`/api/users?${Q}&_method=delete&_status=200`)).status).toBe(200);
  });

  it('HEAD → GET 취급 (무본문)', async () => {
    const res = await call('HEAD', `/api/users?${Q}`);
    expect(res.status).toBe(200);
  });

  it('대소문자 무시', async () => {
    expect((await get(`/api/users?${Q}&_method=PoSt`)).status).toBe(201);
  });

  it('알 수 없는 _method → 400', async () => {
    const res = await get(`/api/users?${Q}&_method=fetch`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; hint: string };
    expect(body.field).toBe('_method');
    expect(body.hint).toContain('PATCH');
  });

  it('CORS 프리플라이트에 PUT·PATCH 광고', async () => {
    const res = await worker.fetch(new Request(BASE + '/api/users', { method: 'OPTIONS' }));
    const allow = res.headers.get('Access-Control-Allow-Methods') || '';
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(allow, m).toContain(m);
  });

  it('DELETE 응답에도 CORS 헤더', async () => {
    const res = await call('DELETE', `/api/users?${Q}`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('/schema/ts — 쓰기 메서드는 단건 타입', () => {
  it('_method=post → Paginated 없이 단일 객체 안내', async () => {
    const ts = await (await get(`/schema/ts?${Q}&_res=users&_method=post`)).text();
    expect(ts).not.toContain('Paginated');
    expect(ts).toContain('단일 객체');
  });
});
