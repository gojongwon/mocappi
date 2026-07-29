/**
 * 연락처 안전 오버라이드 — 형식은 유효, 실존은 불가능
 */
import { describe, it, expect } from 'vitest';
import { compileType, type GenContext } from '../src/registry';

const KO: GenContext = { globalIndex: 0, locale: 'ko' };
const EN: GenContext = { globalIndex: 0, locale: 'en' };
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i * 104729 + 11);

describe('internet.email 오버라이드', () => {
  it('항상 @example.com (RFC 2606) + 유효한 ASCII 유저명', () => {
    const gen = compileType('internet.email');
    for (const s of seeds(50)) {
      const v = gen(s, KO) as string;
      expect(v).toMatch(/^[a-z0-9][a-z0-9._]*@example\.com$/);
    }
  });

  it('시드별 결정적이고 값이 다양하다', () => {
    const gen = compileType('internet.email');
    expect(gen(42, KO)).toBe(gen(42, KO));
    const distinct = new Set(seeds(50).map((s) => gen(s, KO)));
    expect(distinct.size).toBeGreaterThan(30);
  });

  it('nullable 수식자와 조합 가능', () => {
    const gen = compileType('internet.email?1');
    expect(gen(1, KO)).toBeNull();
  });
});

describe('phone.number 오버라이드', () => {
  it('ko 는 010-####-#### 형식', () => {
    const gen = compileType('phone.number');
    for (const s of seeds(30)) {
      expect(gen(s, KO)).toMatch(/^010-\d{4}-\d{4}$/);
    }
  });

  it('en 은 픽션 예약 대역 (###) 555-01##', () => {
    const gen = compileType('phone.number');
    for (const s of seeds(30)) {
      expect(gen(s, EN)).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
    }
  });

  it('시드별 결정적', () => {
    const gen = compileType('phone.number');
    expect(gen(7, KO)).toBe(gen(7, KO));
    expect(gen(7, EN)).toBe(gen(7, EN));
  });
});
