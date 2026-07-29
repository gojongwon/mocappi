/**
 * 대용량 — _limit 1000 + _format=ndjson|csv 스트리밍
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const get = (qs: string) => worker.fetch(new Request(`https://x/api/logs?${qs}`));
const SCHEMA = 'id=uuid&level=enum:info*8%7Cwarn*2&msg=lorem.word&meta.host=lorem.word&tags[]=lorem.word:2';

describe('_format 파싱', () => {
  it('잘못된 형식은 400 + 힌트', async () => {
    const res = await get(`${SCHEMA}&_format=xml`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('ndjson');
  });
});

describe('ndjson', () => {
  it('줄 수 = limit, 각 줄이 유효한 JSON, content-type 정확', async () => {
    const res = await get(`${SCHEMA}&_limit=25&_format=ndjson`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await res.text()).trimEnd().split('\n');
    expect(lines).toHaveLength(25);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('JSON 응답과 아이템이 완전히 동일하다 (_format 은 시드에 영향 없음)', async () => {
    const [nd, js] = await Promise.all([
      get(`${SCHEMA}&_limit=10&_format=ndjson`).then((r) => r.text()),
      get(`${SCHEMA}&_limit=10`).then((r) => r.json() as Promise<{ data: unknown[] }>),
    ]);
    const ndItems = nd.trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(ndItems).toStrictEqual(js.data);
  });

  it('페이지네이션 의미 유지 — _page=2 첫 아이템 = 전역 인덱스 limit 번째', async () => {
    const p2 = await get(`${SCHEMA}&_limit=5&_page=2&_format=ndjson`).then((r) => r.text());
    const big = await get(`${SCHEMA}&_limit=10&_format=ndjson`).then((r) => r.text());
    expect(p2.trimEnd().split('\n')[0]).toBe(big.trimEnd().split('\n')[5]);
  });

  it('두 번 호출이 바이트 동일 (결정성)', async () => {
    const a = await get(`${SCHEMA}&_limit=50&_format=ndjson`).then((r) => r.text());
    const b = await get(`${SCHEMA}&_limit=50&_format=ndjson`).then((r) => r.text());
    expect(a).toBe(b);
  });
});

describe('csv', () => {
  it('헤더는 점 표기 컬럼, 행 수 = limit + 1', async () => {
    const res = await get(`${SCHEMA}&_limit=8&_format=csv`);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('id,level,meta.host,msg,tags');
    expect(lines).toHaveLength(9);
  });

  it('쉼표/따옴표가 든 값은 RFC 4180 이스케이프, 배열은 JSON 문자열', async () => {
    const res = await worker.fetch(
      new Request('https://x/api/t?note=const:hello, "world"&tags[]=const:a:2&_limit=1&_format=csv'),
    );
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[1]).toBe('"hello, ""world""","[""a"",""a""]"');
  });
});

describe('_limit 1000', () => {
  it('1000개 생성 + 초과분은 1000 으로 잘림', async () => {
    const res = await get(`${SCHEMA}&_limit=5000&_total=3000&_format=ndjson`);
    const lines = (await res.text()).trimEnd().split('\n');
    expect(lines).toHaveLength(1000);
  });

  it('JSON 도 1000개 허용', async () => {
    const res = await get(`${SCHEMA}&_limit=1000&_total=2000`);
    const body = (await res.json()) as { data: unknown[]; limit: number };
    expect(body.data).toHaveLength(1000);
    expect(body.limit).toBe(1000);
  });
});
