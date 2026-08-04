/**
 * _sort 정렬 — 데이터는 동일 + 순서만 (창 안에서, total 은 창 개수)
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

type Env = { data: Record<string, unknown>[]; total: number; totalPages: number };
const get = async (qs: string) => {
  const res = await worker.fetch(new Request(`https://x/api/items?${qs}`));
  return { status: res.status, body: (await res.json()) as Env };
};
const text = async (qs: string) => (await worker.fetch(new Request(`https://x/api/items?${qs}`))).text();

const SCHEMA = 'id=index&age=int:20~60&name=lorem.word';
const isSorted = (xs: unknown[], desc = false) =>
  xs.every((v, i) => i === 0 || (desc ? (xs[i - 1] as number) >= (v as number) : (xs[i - 1] as number) <= (v as number)));

describe('_sort', () => {
  it('오름차순', async () => {
    const { body } = await get(`${SCHEMA}&_total=50&_limit=50&_sort=age`);
    expect(body.data).toHaveLength(50);
    expect(isSorted(body.data.map((d) => d.age))).toBe(true);
  });

  it("'-' 접두사는 내림차순", async () => {
    const { body } = await get(`${SCHEMA}&_total=50&_limit=50&_sort=-age`);
    expect(isSorted(body.data.map((d) => d.age), true)).toBe(true);
  });

  it('데이터는 동일하고 순서만 — 같은 집합', async () => {
    const plain = (await get(`${SCHEMA}&_total=40&_limit=40`)).body.data.map((x) => JSON.stringify(x));
    const sorted = (await get(`${SCHEMA}&_total=40&_limit=40&_sort=name`)).body.data.map((x) => JSON.stringify(x));
    expect([...sorted].sort()).toStrictEqual([...plain].sort());
    expect(sorted).not.toStrictEqual(plain); // 순서는 실제로 바뀌었다
  });

  // _sort 가 시드에 안 들어간다는 확인은 determinism.test.ts (불변식 파일) 가 갖고 있다

  it('다중 키 — 첫 키가 동률일 때 두 번째로 정렬', async () => {
    // grade 는 값이 3개뿐이라 동률이 반드시 생긴다
    const { body } = await get(`grade=enum:a%7Cb%7Cc&age=int:20~30&_total=60&_limit=60&_sort=grade,-age`);
    const rows = body.data as Array<{ grade: string; age: number }>;
    expect(isSorted(rows.map((r) => r.grade.charCodeAt(0)))).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].grade === rows[i].grade) expect(rows[i - 1].age).toBeGreaterThanOrEqual(rows[i].age);
    }
  });

  it('점 표기 중첩 경로', async () => {
    const { body } = await get(`a.n=int:1~99&_total=30&_limit=30&_sort=a.n`);
    const ns = body.data.map((d) => (d.a as { n: number }).n);
    expect(isSorted(ns)).toBe(true);
  });

  it('null 은 방향과 무관하게 항상 뒤', async () => {
    for (const s of ['age', '-age']) {
      const { body } = await get(`age=int:20~60?0.4&id=index&_total=80&_limit=80&_sort=${s}`);
      const nullAt = body.data.findIndex((d) => d.age === null);
      expect(nullAt).toBeGreaterThan(-1); // 40% null 이면 80개 중 반드시 나온다
      expect(body.data.slice(nullAt).every((d) => d.age === null)).toBe(true);
    }
  });

  it('페이지네이션 — 정렬된 목록을 자른다', async () => {
    const all = (await get(`${SCHEMA}&_total=60&_limit=60&_sort=age`)).body.data;
    const p2 = (await get(`${SCHEMA}&_total=60&_limit=10&_page=2&_sort=age`)).body.data;
    expect(p2).toStrictEqual(all.slice(10, 20));
  });

  it('_q 조합 — 매치 안에서 정렬', async () => {
    const { body } = await get(`tag=enum:apple%7Cbanana&age=int:20~60&_total=80&_limit=80&_q=apple&_sort=-age`);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBe(body.data.length);
    for (const it of body.data) expect(it.tag).toBe('apple');
    expect(isSorted(body.data.map((d) => d.age), true)).toBe(true);
  });

  it('창(1,000)보다 큰 _total → total 은 창 개수', async () => {
    const { status, body } = await get(`${SCHEMA}&_total=100000&_limit=10&_sort=age`);
    expect(status).toBe(200);
    expect(body.total).toBe(1000);
    expect(body.totalPages).toBe(100);
  });

  it('ndjson·csv 도 같은 순서', async () => {
    const js = (await get(`${SCHEMA}&_total=50&_limit=50&_sort=-age`)).body.data;
    const nd = (await text(`${SCHEMA}&_total=50&_limit=50&_sort=-age&_format=ndjson`))
      .trimEnd().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(nd).toStrictEqual(js);
    const csv = (await text(`${SCHEMA}&_total=50&_limit=50&_sort=-age&_format=csv`)).trimEnd().split('\r\n');
    expect(csv[0]).toBe('age,id,name'); // 필드는 이름순 정렬 (기존 규칙)
    expect(csv.slice(1).map((r) => Number(r.split(',')[0]))).toStrictEqual(js.map((d) => d.age));
  });

  it('두 번 호출이 동일 (결정성)', async () => {
    const a = await text(`${SCHEMA}&_total=50&_sort=name,-age`);
    expect(a).toBe(await text(`${SCHEMA}&_total=50&_sort=name,-age`));
  });

  it('_wrap=none 은 정렬된 배열만', async () => {
    const arr = JSON.parse(await text(`${SCHEMA}&_total=30&_limit=30&_wrap=none&_sort=age`)) as Array<{ age: number }>;
    expect(Array.isArray(arr)).toBe(true);
    expect(isSorted(arr.map((d) => d.age))).toBe(true);
  });

  it('없는 필드는 400 + 가용 목록 안내', async () => {
    const { status, body } = await get(`${SCHEMA}&_sort=nope`);
    expect(status).toBe(400);
    expect((body as unknown as { error: string }).error).toBe('Unknown sort field');
    expect((body as unknown as { hint: string }).hint).toContain('age');
  });

  it('_wrap=one 과 같이 쓰면 400 (정렬할 목록이 없다)', async () => {
    const { status } = await get(`${SCHEMA}&_wrap=one&_sort=age`);
    expect(status).toBe(400);
  });

  it("'-' 만 있으면 400", async () => {
    expect((await get(`${SCHEMA}&_sort=-`)).status).toBe(400);
  });

  it('_alias 로 실제 API 키 이름 사용', async () => {
    const { status, body } = await get(`${SCHEMA}&_total=40&_limit=40&_alias=order:_sort&order=-age`);
    expect(status).toBe(200);
    expect(isSorted(body.data.map((d) => d.age), true)).toBe(true);
  });
});
