/**
 * mask.* — 마스킹된 개인정보 타입 (name/email/phone/card)
 */
import { describe, it, expect } from 'vitest';
import { compileType } from '../src/registry';
import worker from '../src/index';

const ctx = (locale: 'ko' | 'en' | 'ja' | 'zh' = 'ko') => ({ globalIndex: 0, locale });

describe('mask.name', () => {
  it('ko — 첫·끝 글자만 남기고 가운데 *', () => {
    const gen = compileType('mask.name');
    for (let s = 1; s <= 20; s++) {
      const v = String(gen(s, ctx('ko')));
      expect(v).toMatch(/^[^*]\*+[^*]$|^[^*]\*$/); // 김*준 또는 김*
    }
  });

  it('en — 이름만 가리고 성은 남긴다 (J*** Smith)', () => {
    const gen = compileType('mask.name');
    const v = String(gen(7, ctx('en')));
    expect(v).toMatch(/^.\*\*\* /);
    expect(v.split(' ').length).toBeGreaterThanOrEqual(2);
  });

  it('원본 이름과 첫 글자가 일치한다 (같은 시드 파생)', () => {
    const full = String(compileType('person.fullName')(42, ctx('ko')));
    const masked = String(compileType('mask.name')(42, ctx('ko')));
    expect(masked[0]).toBe(full[0]);
    expect(masked.length).toBe([...full].length);
  });

  it('결정성 — 같은 시드는 같은 값', () => {
    const gen = compileType('mask.name');
    expect(gen(99, ctx())).toBe(gen(99, ctx()));
  });
});

describe('mask.email', () => {
  it('앞 2글자 + *** + @example.com', () => {
    const gen = compileType('mask.email');
    for (let s = 1; s <= 10; s++) {
      expect(String(gen(s, ctx()))).toMatch(/^[a-z0-9]{1,2}\*\*\*@example\.com$/);
    }
  });

  it('원본 이메일에서 파생 — 앞 2글자 일치', () => {
    const email = String(compileType('internet.email')(5, ctx()));
    const masked = String(compileType('mask.email')(5, ctx()));
    expect(email.startsWith(masked.slice(0, 2))).toBe(true);
  });
});

describe('mask.phone', () => {
  it('ko — 010-****-5678 형식', () => {
    expect(String(compileType('mask.phone')(3, ctx('ko')))).toMatch(/^010-\*{4}-\d{4}$/);
  });
  it('ja — 090-****-1234 형식', () => {
    expect(String(compileType('mask.phone')(3, ctx('ja')))).toMatch(/^090-\*{4}-\d{4}$/);
  });
  it('en — (###) ***-#### 형식', () => {
    expect(String(compileType('mask.phone')(3, ctx('en')))).toMatch(/^\(\d{3}\) \*{3}-\d{4}$/);
  });
  it('zh — 앞3 + **** + 뒤4 (구분자 없음)', () => {
    expect(String(compileType('mask.phone')(3, ctx('zh')))).toMatch(/^\d{3}\*{4}\d{4}$/);
  });
  it('마지막 4자리는 원본 전화번호와 일치', () => {
    const phone = String(compileType('phone.number')(11, ctx('ko')));
    const masked = String(compileType('mask.phone')(11, ctx('ko')));
    expect(masked.slice(-4)).toBe(phone.slice(-4));
  });
});

describe('mask.card', () => {
  it('****-****-****-#### 형식 + 결정성', () => {
    const gen = compileType('mask.card');
    const v = String(gen(8, ctx()));
    expect(v).toMatch(/^\*{4}-\*{4}-\*{4}-\d{4}$/);
    expect(gen(8, ctx())).toBe(v);
  });
});

describe('통합', () => {
  it('nullable 수식자와 조합 가능 — mask.name?1 은 항상 null', () => {
    expect(compileType('mask.name?1')(1, ctx())).toBeNull();
  });

  it('없는 마스킹 타입은 전용 힌트로 400', async () => {
    const res = await worker.fetch(new Request('https://x/api/u?a=mask.rrn'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe('Unknown mask type');
    expect(body.hint).toContain('mask.name');
  });

  it('E2E — 응답에 마스킹 값이 들어간다', async () => {
    const res = await worker.fetch(
      new Request('https://x/api/users?name=mask.name&mail=mask.email&tel=mask.phone&card=mask.card&_limit=5'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, string>[] };
    for (const it of body.data) {
      expect(it.name).toContain('*');
      expect(it.mail).toMatch(/\*\*\*@example\.com$/);
      expect(it.tel).toContain('*');
      expect(it.card).toMatch(/^\*{4}-/);
    }
  });
});
