/**
 * _alias — 예약 파라미터 키 커스텀
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { saveSchema } from '../src/store';
import { MemKV } from './helpers';

const fetchText = async (url: string, env?: object) => {
  const res = await worker.fetch(new Request(url), env as never);
  return { status: res.status, text: await res.text() };
};
const BASE = 'https://x/api/u?name=person.fullName&age=int:20~60';

describe('_alias', () => {
  it('별칭 호출과 원래 키 호출이 바이트 동일 (시드 불변)', async () => {
    const direct = await fetchText(`${BASE}&_page=2&_limit=5&_total=300`);
    const aliased = await fetchText(`${BASE}&_alias=page:_page,size:_limit,cnt:_total&page=2&size=5&cnt=300`);
    expect(aliased.status).toBe(200);
    expect(aliased.text).toBe(direct.text);
  });

  it('_q 별칭 (keyword) 도 동작', async () => {
    const direct = await fetchText(`${BASE}&_q=%EA%B9%80&_limit=100`);
    const aliased = await fetchText(`${BASE}&_alias=keyword:_q&keyword=%EA%B9%80&_limit=100`);
    expect(aliased.text).toBe(direct.text);
  });

  it('별칭과 원래 키 동시 사용은 400', async () => {
    const { status } = await fetchText(`${BASE}&_alias=page:_page&page=2&_page=3`);
    expect(status).toBe(400);
  });

  it('예약어가 아닌 대상은 400 + 목록 안내', async () => {
    const res = await worker.fetch(new Request(`${BASE}&_alias=page:_nope`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('_page');
  });

  it('형식이 틀리면 400', async () => {
    expect((await fetchText(`${BASE}&_alias=page`)).status).toBe(400);
    expect((await fetchText(`${BASE}&_alias=_bad:_page`)).status).toBe(400);
  });

  it('_s 저장 스키마와 조합 — 실제 API 모양으로 호출', async () => {
    const kv = new MemKV();
    const rec = await saveSchema(kv, 'aliasws00001', '유저', 'u', 'name=person.fullName&_alias=page:_page,size:_limit');
    const env = { SCHEMAS: kv };
    const viaAlias = await fetchText(`https://x/api/u?_s=${rec.sid}&page=2&size=4&_total=100`, env);
    const direct = await fetchText(`https://x/api/u?name=person.fullName&_page=2&_limit=4&_total=100`);
    expect(viaAlias.status).toBe(200);
    expect(JSON.parse(viaAlias.text).data).toStrictEqual(JSON.parse(direct.text).data);
  });
});
