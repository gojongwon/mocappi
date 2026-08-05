/**
 * X-Total-Count — envelope 이 없는 응답(_wrap=none·ndjson·csv)에서도 전체 개수를 얻는 길.
 * 목 API 는 크로스오리진으로 불리므로 Expose-Headers 가 같이 나가야 브라우저가 읽을 수 있다.
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const SCHEMA = 'id=index&age=int:20~60&tag=enum:apple%7Cbanana';
const call = (qs: string, method = 'GET') =>
  worker.fetch(new Request(`https://x/api/items?${qs}`, { method }));
const count = async (qs: string, method = 'GET') => (await call(qs, method)).headers.get('x-total-count');

describe('X-Total-Count', () => {
  it('envelope 의 total 과 같다', async () => {
    const res = await call(`${SCHEMA}&_total=500&_limit=20`);
    const body = (await res.json()) as { total: number };
    expect(res.headers.get('x-total-count')).toBe('500');
    expect(body.total).toBe(500);
  });

  it('_wrap=none — 배열엔 total 이 없으니 헤더가 유일한 통로', async () => {
    expect(await count(`${SCHEMA}&_total=300&_limit=10&_wrap=none`)).toBe('300');
  });

  it('ndjson·csv 스트리밍', async () => {
    expect(await count(`${SCHEMA}&_total=250&_limit=10&_format=ndjson`)).toBe('250');
    expect(await count(`${SCHEMA}&_total=250&_limit=10&_format=csv`)).toBe('250');
  });

  it('_q 는 매치 수 — envelope total 과 일치', async () => {
    const res = await call(`${SCHEMA}&_total=80&_limit=100&_q=apple`);
    const body = (await res.json()) as { total: number; data: unknown[] };
    expect(res.headers.get('x-total-count')).toBe(String(body.total));
    expect(body.total).toBe(body.data.length);
    // 스트리밍도 같은 값
    expect(await count(`${SCHEMA}&_total=80&_limit=100&_q=apple&_format=ndjson`)).toBe(String(body.total));
  });

  it('_sort 는 창 개수', async () => {
    expect(await count(`${SCHEMA}&_total=100000&_limit=10&_sort=age`)).toBe('1000');
    expect(await count(`${SCHEMA}&_total=100000&_limit=10&_sort=age&_format=csv`)).toBe('1000');
  });

  it('페이지가 달라도 전체 개수는 그대로', async () => {
    expect(await count(`${SCHEMA}&_total=500&_limit=20&_page=7`)).toBe('500');
    expect(await count(`${SCHEMA}&_total=500&_limit=20&_page=999`)).toBe('500'); // 범위 초과 페이지
  });

  it('목록이 아닌 응답에는 없다', async () => {
    expect(await count(`${SCHEMA}&_wrap=one`)).toBeNull(); // 단일 객체
    expect(await count(`${SCHEMA}`, 'POST')).toBeNull(); // 201 단건
    expect(await count(`${SCHEMA}`, 'DELETE')).toBeNull(); // 204 무본문
    expect(await count(`${SCHEMA}&_status=500`)).toBeNull(); // 실패 바디
    expect(await count(`_sort=nope`)).toBeNull(); // 400
  });

  it('Access-Control-Expose-Headers 로 노출된다', async () => {
    const res = await call(`${SCHEMA}&_total=10`);
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Total-Count, X-Mock-State');
    // 프리플라이트에도 실려 나간다
    const pre = await call(`${SCHEMA}`, 'OPTIONS');
    expect(pre.headers.get('access-control-expose-headers')).toBe('X-Total-Count, X-Mock-State');
  });
});
