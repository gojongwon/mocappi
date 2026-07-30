/**
 * _q 검색 — 생성 데이터 필터 (데이터 동일 + 필터만, total = 매치 수)
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

type Env = { data: Record<string, unknown>[]; total: number; totalPages: number; page: number };
const get = async (qs: string) => {
  const res = await worker.fetch(new Request(`https://x/api/items?${qs}`));
  return { status: res.status, body: (await res.json()) as Env };
};
const SCHEMA = 'id=index&tag=enum:apple%7Cbanana%7Ccherry&name=lorem.word';

describe('_q 검색', () => {
  it('매치만 반환하고 total 은 매치 수', async () => {
    const { body } = await get(`${SCHEMA}&_total=60&_limit=100&_q=apple`);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.length).toBeLessThan(60);
    expect(body.total).toBe(body.data.length);
    for (const it of body.data) {
      expect(JSON.stringify(it).toLowerCase()).toContain('apple');
    }
  });

  it('데이터는 동일하고 필터만 — 검색 결과는 무검색 데이터의 부분집합', async () => {
    const all = (await get(`${SCHEMA}&_total=60&_limit=100`)).body.data.map((x) => JSON.stringify(x));
    const hits = (await get(`${SCHEMA}&_total=60&_limit=100&_q=banana`)).body.data.map((x) => JSON.stringify(x));
    for (const h of hits) expect(all).toContain(h);
  });

  it('대소문자 무시', async () => {
    const a = (await get(`${SCHEMA}&_total=40&_limit=100&_q=APPLE`)).body.total;
    const b = (await get(`${SCHEMA}&_total=40&_limit=100&_q=apple`)).body.total;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it('숫자 값도 검색된다 (id=index 에서 7)', async () => {
    const { body } = await get(`id=index&x=const:zz&_total=20&_limit=100&_q=7`);
    expect(body.data.map((d) => d.id)).toContain(7);
    expect(body.data.map((d) => d.id)).toContain(17);
  });

  it('페이지네이션은 매치 목록 기준', async () => {
    const p1 = (await get(`${SCHEMA}&_total=200&_limit=5&_page=1&_q=apple`)).body;
    const p2 = (await get(`${SCHEMA}&_total=200&_limit=5&_page=2&_q=apple`)).body;
    expect(p1.data).toHaveLength(5);
    expect(p1.totalPages).toBe(Math.ceil(p1.total / 5));
    expect(JSON.stringify(p1.data[0])).not.toBe(JSON.stringify(p2.data[0]));
  });

  it('매치 없으면 빈 배열 + total 0', async () => {
    const { body } = await get(`${SCHEMA}&_total=30&_q=zzzzzz`);
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('두 번 호출이 동일 (결정성)', async () => {
    const a = JSON.stringify((await get(`${SCHEMA}&_total=50&_q=cherry`)).body);
    const b = JSON.stringify((await get(`${SCHEMA}&_total=50&_q=cherry`)).body);
    expect(a).toBe(b);
  });

  it('_wrap=none 은 매치 배열만', async () => {
    const res = await worker.fetch(new Request(`https://x/api/items?${SCHEMA}&_total=30&_wrap=none&_q=apple`));
    const arr = (await res.json()) as unknown[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
  });

  it('ndjson 조합 — JSON 검색 결과와 동일', async () => {
    const js = (await get(`${SCHEMA}&_total=50&_limit=100&_q=banana`)).body.data;
    const res = await worker.fetch(new Request(`https://x/api/items?${SCHEMA}&_total=50&_limit=100&_q=banana&_format=ndjson`));
    const lines = (await res.text()).trimEnd().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines).toStrictEqual(js);
  });

  it('_total 이 커도 스캔 창(1,000) 안에서만 — 정상 응답', async () => {
    const { status, body } = await get(`id=index&_total=100000&_q=99999`);
    expect(status).toBe(200);
    expect(body.total).toBe(0); // 99999 는 창(0~999) 밖 인덱스라 매치 없음
  });

  it('100자 초과 검색어는 400', async () => {
    const { status } = await get(`${SCHEMA}&_q=${'x'.repeat(101)}`);
    expect(status).toBe(400);
  });
});
