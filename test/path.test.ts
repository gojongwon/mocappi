/**
 * 다단계 경로 + _wrap=one (상세 엔드포인트)
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { interfaceName } from '../src/tstype';

const fetchJson = async (url: string) => {
  const res = await worker.fetch(new Request(url));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const Q = 'name=person.fullName&age=int:20~60&_limit=3';

describe('다단계 경로', () => {
  it('경로는 장식 — 깊이가 달라도 같은 쿼리면 같은 데이터', async () => {
    const flat = await fetchJson(`https://x/api/users?${Q}`);
    const deep = await fetchJson(`https://x/api/v2/shops/57/reviews?${Q}`);
    expect(deep.status).toBe(200);
    expect(JSON.stringify(deep.body)).toBe(JSON.stringify(flat.body));
  });

  it('8단계까지 허용, 초과·빈 세그먼트는 404', async () => {
    const ok = await fetchJson(`https://x/api/a/b/c/d/e/f/g/h?${Q}`);
    expect(ok.status).toBe(200);
    expect((await fetchJson(`https://x/api/a/b/c/d/e/f/g/h/i?${Q}`)).status).toBe(404);
    expect((await fetchJson(`https://x/api/users//orders?${Q}`)).status).toBe(404);
  });
});

describe('_wrap=one', () => {
  it('단일 객체 반환 — 리스트의 첫 아이템과 동일', async () => {
    const list = await fetchJson(`https://x/api/users?${Q}`);
    const one = await fetchJson(`https://x/api/users/1?${Q}&_wrap=one`);
    expect(Array.isArray(one.body)).toBe(false);
    expect(one.body).toStrictEqual((list.body as { data: unknown[] }).data[0]);
  });

  it('_seed 로 개체별 상세 — id 가 다르면 데이터도 다르고 각각 결정적', async () => {
    const a1 = await fetchJson(`https://x/api/users/123?${Q}&_wrap=one&_seed=123`);
    const a2 = await fetchJson(`https://x/api/users/123?${Q}&_wrap=one&_seed=123`);
    const b = await fetchJson(`https://x/api/users/456?${Q}&_wrap=one&_seed=456`);
    expect(a1.body).toStrictEqual(a2.body);
    expect(JSON.stringify(a1.body)).not.toBe(JSON.stringify(b.body));
  });
});

describe('TS 타입 — 다단계 리소스명', () => {
  it('마지막 비숫자 세그먼트로 인터페이스명', () => {
    expect(interfaceName('v2/users/123')).toBe('User');
    expect(interfaceName('shops/5/reviews')).toBe('Review');
    expect(interfaceName('123')).toBe('Item');
  });

  it('/schema/ts 가 _wrap=one 안내를 포함', async () => {
    const res = await worker.fetch(new Request(`https://x/schema/ts?name=person.fullName&_wrap=one&_res=users/1`));
    const ts = await res.text();
    expect(ts).toContain('interface User');
    expect(ts).toContain('단일 객체');
  });
});
