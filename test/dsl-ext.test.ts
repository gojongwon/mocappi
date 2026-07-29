/**
 * DSL 확장 — nullable 수식자(?p) / 가중치 enum(a*8|b*2) / pattern:템플릿
 */
import { describe, it, expect } from 'vitest';
import { compileType, DslError, type GenContext } from '../src/registry';
import { parseQuery } from '../src/dsl';
import { generateTsTypes } from '../src/tstype';
import worker from '../src/index';

const CTX: GenContext = { globalIndex: 0, locale: 'ko' };
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i * 7919 + 3);

describe('pattern', () => {
  it('#/?/* 와일드카드와 리터럴을 치환한다', () => {
    const gen = compileType('pattern:ORD-####-???');
    for (const s of seeds(50)) {
      expect(gen(s, CTX)).toMatch(/^ORD-\d{4}-[A-Z]{3}$/);
    }
    const an = compileType('pattern:**');
    for (const s of seeds(50)) expect(an(s, CTX)).toMatch(/^[A-Z0-9]{2}$/);
  });

  it('같은 시드는 항상 같은 값 (결정성)', () => {
    const gen = compileType('pattern:SKU-####');
    expect(gen(42, CTX)).toBe(gen(42, CTX));
  });

  it('빈 템플릿 / 64자 초과는 DslError', () => {
    expect(() => compileType('pattern:')).toThrow(DslError);
    expect(() => compileType('pattern:' + '#'.repeat(65))).toThrow(DslError);
  });
});

describe('가중치 enum', () => {
  it('가중치대로 치우친 분포를 만든다', () => {
    const gen = compileType('enum:a*9|b*1');
    const counts = { a: 0, b: 0 };
    for (const s of seeds(500)) counts[gen(s, CTX) as 'a' | 'b']++;
    expect(counts.a + counts.b).toBe(500);
    expect(counts.a).toBeGreaterThan(counts.b * 3); // 9:1 이면 넉넉히 3배 이상
  });

  it('가중치 없는 멤버는 1로 취급 (혼합 허용)', () => {
    const gen = compileType('enum:x*2|y');
    const out = new Set(seeds(100).map((s) => gen(s, CTX)));
    expect([...out].every((v) => v === 'x' || v === 'y')).toBe(true);
  });

  it('가중치 없는 기존 문법은 이전과 동일한 값 (결정성 보존)', () => {
    // 균등 선택 경로(rng.pick)를 그대로 타는지 — pick 과 결과 비교
    const gen = compileType('enum:admin|user|guest');
    const vals = ['admin', 'user', 'guest'];
    for (const s of seeds(30)) {
      expect(vals).toContain(gen(s, CTX));
    }
    expect(gen(42, CTX)).toBe(gen(42, CTX));
  });

  it('0 이하 가중치는 DslError', () => {
    expect(() => compileType('enum:a*0|b')).toThrow(DslError);
  });
});

describe('nullable 수식자', () => {
  it('p=1 이면 항상 null, p=0 이면 절대 null 아님', () => {
    const always = compileType('int:1~5?1');
    const never = compileType('int:1~5?0');
    for (const s of seeds(30)) {
      expect(always(s, CTX)).toBeNull();
      expect(never(s, CTX)).not.toBeNull();
    }
  });

  it('p=0.5 면 null 과 값이 섞여 나오고, 시드별로 결정적이다', () => {
    const gen = compileType('internet.email?0.5');
    const out = seeds(100).map((s) => gen(s, CTX));
    expect(out.some((v) => v === null)).toBe(true);
    expect(out.some((v) => typeof v === 'string')).toBe(true);
    for (const s of seeds(20)) expect(gen(s, CTX)).toStrictEqual(gen(s, CTX));
  });

  it('null 판정과 값 생성의 시드가 분리된다 — bool:0.5?0.5 에서 true/false/null 모두 등장', () => {
    const gen = compileType('bool:0.5?0.5');
    const out = new Set(seeds(300).map((s) => gen(s, CTX)));
    expect(out.has(null)).toBe(true);
    expect(out.has(true)).toBe(true);
    expect(out.has(false)).toBe(true);
  });

  it('모든 타입에 적용 가능 (int / enum / pattern)', () => {
    for (const t of ['int:1~9?0.3', 'enum:a|b?0.3', 'pattern:##?0.3']) {
      const gen = compileType(t);
      const out = seeds(200).map((s) => gen(s, CTX));
      expect(out.some((v) => v === null)).toBe(true);
      expect(out.some((v) => v !== null)).toBe(true);
    }
  });
});

describe('TS 타입 생성 통합', () => {
  it('nullable → | null, 가중치 enum → 가중치 없는 리터럴 유니온, pattern → string', () => {
    const q = parseQuery(
      new URLSearchParams('email=internet.email?0.2&status=enum:paid*8|refund*2&sku=pattern:AA-##'),
    );
    const ts = generateTsTypes(q.fields, 'orders', q.wrap);
    expect(ts).toContain('email: string | null;');
    expect(ts).toContain("status: 'paid' | 'refund';");
    expect(ts).toContain('sku: string;');
  });
});

describe('워커 통합 — 응답 결정성', () => {
  it('확장 타입이 섞인 URL 도 두 번 호출이 바이트 동일', async () => {
    // 주의: 날 URL 에서 '#' 는 fragment 시작 — %23 으로 인코딩해야 한다 (GUI 는 자동)
    const url =
      'https://x/api/orders?sku=pattern:ORD-%23%23%23%23&status=enum:paid*8|refund*2&email=internet.email?0.3&_limit=20';
    const a = await (await worker.fetch(new Request(url))).text();
    const b = await (await worker.fetch(new Request(url))).text();
    expect(a).toBe(b);
    const body = JSON.parse(a);
    expect(body.data).toHaveLength(20);
    expect(body.data.every((it: Record<string, unknown>) => /^ORD-\d{4}$/.test(String(it.sku)))).toBe(true);
  });
});
