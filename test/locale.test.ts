/**
 * 로케일 — ja / zh 지원
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const get = async (qs: string) => {
  const res = await worker.fetch(new Request(`https://x/api/people?${qs}`));
  return { status: res.status, body: (await res.json()) as { data: Record<string, string>[] } };
};
const S = 'name=person.fullName&city=location.city&tel=phone.number&_limit=5';

describe('_locale=ja|zh', () => {
  it('ja — CJK 이름 + 090 전화 형식', async () => {
    const { status, body } = await get(`${S}&_locale=ja`);
    expect(status).toBe(200);
    expect(body.data.some((it) => /[぀-ヿ一-鿿]/.test(it.name))).toBe(true);
    for (const it of body.data) expect(it.tel).toMatch(/^090-\d{4}-\d{4}$/);
  });

  it('zh — 한자 이름 + 11자리 휴대폰', async () => {
    const { status, body } = await get(`${S}&_locale=zh`);
    expect(status).toBe(200);
    expect(body.data.some((it) => /[一-鿿]/.test(it.name))).toBe(true);
    for (const it of body.data) expect(it.tel).toMatch(/^1[3-9]\d{9}$/);
  });

  it('로케일별 결정성 — 두 번 호출 동일, 로케일 간 데이터는 다름', async () => {
    const a = JSON.stringify((await get(`${S}&_locale=ja`)).body);
    const b = JSON.stringify((await get(`${S}&_locale=ja`)).body);
    const c = JSON.stringify((await get(`${S}&_locale=zh`)).body);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('잘못된 로케일은 400', async () => {
    const { status } = await get(`${S}&_locale=fr`);
    expect(status).toBe(400);
  });
});
