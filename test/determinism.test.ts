import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/dsl';
import { generateResponse, type Envelope } from '../src/generate';

function run(qs: string): Envelope {
  return generateResponse(parseQuery(new URLSearchParams(qs))) as Envelope;
}

function runRaw(qs: string): string {
  return JSON.stringify(generateResponse(parseQuery(new URLSearchParams(qs))));
}

const BASE = 'id=uuid&name=person.fullName&email=internet.email&age=int:20~60&seq=index';

describe('결정론', () => {
  it('같은 쿼리 2회 → 바이트 단위 동일', () => {
    const qs = `${BASE}&_total=500&_limit=20&_page=3`;
    expect(runRaw(qs)).toBe(runRaw(qs));
  });

  it('_limit=10&_page=2 의 1번째 == _limit=20&_page=1 의 11번째', () => {
    const a = run(`${BASE}&_total=500&_limit=10&_page=2`);
    const b = run(`${BASE}&_total=500&_limit=20&_page=1`);
    expect(a.data[0]).toEqual(b.data[10]);
    // 페이지 경계 전체 교차 확인
    const c = run(`${BASE}&_total=500&_limit=5&_page=3`); // 전역 10~14
    for (let i = 0; i < 5; i++) expect(c.data[i]).toEqual(b.data[10 + i]);
  });

  it('필드 순서만 바꾼 URL → 동일 결과', () => {
    const a = runRaw(`name=person.fullName&age=int:20~60&id=uuid&_total=50`);
    const b = runRaw(`id=uuid&age=int:20~60&name=person.fullName&_total=50`);
    expect(a).toBe(b);
  });

  it('_delay/_status/_wrap 만 다른 URL → 데이터 동일', () => {
    const a = run(`${BASE}&_total=50`);
    const b = run(`${BASE}&_total=50&_delay=3000&_status=500`);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    const c = generateResponse(parseQuery(new URLSearchParams(`${BASE}&_total=50&_wrap=none`)));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a.data));
  });

  it('예약 파라미터 기본값 명시 여부와 무관하게 동일 시드', () => {
    const a = runRaw(`${BASE}`);
    const b = runRaw(`${BASE}&_locale=ko&_total=100&_page=1&_limit=10`);
    expect(a).toBe(b);
  });

  it('_seed 명시 시 _total 이 달라도 같은 인덱스 항목은 동일', () => {
    const a = run(`${BASE}&_seed=abc&_total=100`);
    const b = run(`${BASE}&_seed=abc&_total=999`);
    expect(a.data[0]).toEqual(b.data[0]);
  });

  it('_seed 값이 다르면 데이터가 달라짐', () => {
    const a = run(`${BASE}&_seed=abc`);
    const b = run(`${BASE}&_seed=xyz`);
    expect(JSON.stringify(a.data)).not.toBe(JSON.stringify(b.data));
  });

  it('배열 항목도 전역 인덱스 기준 안정적', () => {
    const a = run(`tags[]=lorem.word:3&_limit=10&_page=2&_total=100`);
    const b = run(`tags[]=lorem.word:3&_limit=20&_page=1&_total=100`);
    expect(a.data[0]).toEqual(b.data[10]);
  });

  it('로케일이 다르면 다른 데이터, 같은 로케일이면 같은 데이터', () => {
    const ko = run(`name=person.fullName&_locale=ko`);
    const en = run(`name=person.fullName&_locale=en`);
    expect(JSON.stringify(ko.data)).not.toBe(JSON.stringify(en.data));
    // 한글 포함 확인
    const names = (ko.data as Array<{ name: string }>).map((d) => d.name).join('');
    expect(names).toMatch(/[가-힣]/);
  });
});

describe('페이지네이션', () => {
  it('마지막 페이지 잘림: _total=25&_limit=10&_page=3 → 5개', () => {
    const r = run(`id=uuid&_total=25&_limit=10&_page=3`);
    expect(r.data).toHaveLength(5);
    expect(r.totalPages).toBe(3);
    expect(r.hasNext).toBe(false);
    expect(r.hasPrev).toBe(true);
  });

  it('범위 초과 페이지 → 빈 배열 + hasNext:false (에러 아님)', () => {
    const r = run(`id=uuid&_total=25&_limit=10&_page=99`);
    expect(r.data).toEqual([]);
    expect(r.hasNext).toBe(false);
  });

  it('_limit 상한 1000 강제', () => {
    const r = run(`id=uuid&_total=5000&_limit=9999`);
    expect(r.limit).toBe(1000);
    expect(r.data).toHaveLength(1000);
  });

  it('envelope 필드 구성', () => {
    const r = run(`id=uuid&_total=500&_limit=20&_page=2`);
    expect(r).toMatchObject({ page: 2, limit: 20, total: 500, totalPages: 25, hasNext: true, hasPrev: true });
  });

  it('_total=0 → 빈 배열', () => {
    const r = run(`id=uuid&_total=0`);
    expect(r.data).toEqual([]);
    expect(r.totalPages).toBe(0);
    expect(r.hasNext).toBe(false);
  });
});
