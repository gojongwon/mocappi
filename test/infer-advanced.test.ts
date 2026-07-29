/**
 * 추론 고급 감지 — 컬럼 샘플 기반 nullable / enum(가중치) / pattern / 분포
 */
import { describe, it, expect } from 'vitest';
import { inferSchema } from '../src/infer';
import { compileType } from '../src/registry';

const typeOf = (r: ReturnType<typeof inferSchema>, name: string) =>
  r.fields.find((f) => f.name === name)?.type;

describe('nullable 감지', () => {
  it('null 이 섞인 필드는 ?비율 이 붙는다', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      email: i < 5 ? `u${i}@x.com` : null,
    }));
    const r = inferSchema({ data: items });
    expect(typeOf(r, 'email')).toBe('internet.email?0.5');
  });

  it('전부 null 인 필드는 여전히 skipped', () => {
    const r = inferSchema({ data: [{ a: 1, b: null }, { a: 2, b: null }] });
    expect(typeOf(r, 'b')).toBeUndefined();
    expect(r.skipped.some((s) => s.path === 'b')).toBe(true);
  });

  it('중첩 객체가 null 인 항목도 리프 null 로 집계된다', () => {
    const items = [
      { meta: { tag: 'hot' } }, { meta: null }, { meta: { tag: 'hot' } },
      { meta: { tag: 'cold' } }, { meta: null }, { meta: { tag: 'hot' } },
    ];
    const r = inferSchema({ data: items });
    const t = typeOf(r, 'meta.tag');
    expect(t).toMatch(/\?0\.3$/);
  });
});

describe('enum 감지', () => {
  it('반복되는 소수 값 + 치우친 빈도 → 가중치 enum', () => {
    const vals = ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'refund', 'refund'];
    const r = inferSchema({ data: vals.map((s) => ({ id: 1, state: s })) });
    expect(typeOf(r, 'state')).toBe('enum:paid*4|refund*1');
  });

  it('빈도가 비슷하면 가중치 없는 enum', () => {
    const vals = ['a1', 'b2', 'a1', 'b2', 'a1', 'b2'];
    const r = inferSchema({ data: vals.map((s) => ({ id: 1, kind: s })) });
    expect(typeOf(r, 'kind')).toBe('enum:a1|b2');
  });

  it('전부 제각각인 값(이름 등)은 enum 이 되지 않는다', () => {
    const vals = ['kim', 'lee', 'park', 'choi', 'jung', 'kang'];
    const r = inferSchema({ data: vals.map((s) => ({ id: 1, nickname: s })) });
    expect(typeOf(r, 'nickname')).toBe('lorem.word');
  });

  it('uuid/email 은 반복돼도 enum 으로 바뀌지 않는다', () => {
    const items = Array.from({ length: 6 }, () => ({
      uid: '3f2b8c4d-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      mail: 'same@x.com',
    }));
    const r = inferSchema({ data: items });
    expect(typeOf(r, 'uid')).toBe('uuid');
    expect(typeOf(r, 'mail')).toBe('internet.email');
  });
});

describe('pattern 감지', () => {
  it('같은 구조의 코드 → pattern 템플릿', () => {
    const skus = ['ORD-4821-KQZ', 'ORD-1073-XAB', 'ORD-9950-MTR', 'ORD-3316-PWL'];
    const r = inferSchema({ data: skus.map((s) => ({ id: 1, sku: s })) });
    expect(typeOf(r, 'sku')).toBe('pattern:ORD-####-???');
  });

  it('길이가 흔들리면 pattern 이 아니다', () => {
    const skus = ['ORD-1', 'ORD-4821', 'ORD-99'];
    const r = inferSchema({ data: skus.map((s) => ({ id: 1, sku: s })) });
    expect(typeOf(r, 'sku')).not.toMatch(/^pattern:/);
  });

  it('숫자/대문자 혼합 자리는 * 로', () => {
    const codes = ['AB-1X2', 'AB-9Z8', 'AB-C34'];
    const r = inferSchema({ data: codes.map((s) => ({ id: 1, refcode: s })) });
    expect(typeOf(r, 'refcode')).toBe('pattern:AB-**#');
  });
});

describe('분포 감지', () => {
  it('bool 은 표본 비율로 확률이 붙는다', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, active: i < 8 }));
    const r = inferSchema({ data: items });
    expect(typeOf(r, 'active')).toBe('bool:0.8');
  });

  it('숫자 범위는 표본 최대값 기준', () => {
    const items = [3, 87, 41, 96].map((n) => ({ id: 1, score: n }));
    const r = inferSchema({ data: items });
    expect(typeOf(r, 'score')).toBe('int:0~100');
  });
});

describe('통합 안전성', () => {
  it('감지된 모든 타입은 compileType 을 통과한다', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      state: i % 5 === 0 ? 'closed' : 'open',
      sku: `INV-${String(1000 + i)}`,
      mail: i % 3 === 0 ? null : `u${i}@x.com`,
      ok: i % 4 !== 0,
      score: i * 7.5,
    }));
    const r = inferSchema({ data: { items } });
    expect(r.fields.length).toBeGreaterThan(4);
    for (const f of r.fields) {
      const t = f.name.endsWith('[]') ? f.type.replace(/:\d+$/, '') : f.type;
      expect(() => compileType(t)).not.toThrow();
    }
  });

  it('단일 객체(표본 1개)는 기존 추론 그대로', () => {
    const r = inferSchema({ status: 'active', name: '김민준', age: 34 });
    expect(typeOf(r, 'status')).toBe('enum:active');
    expect(typeOf(r, 'name')).toBe('person.fullName');
    expect(typeOf(r, 'age')).toBe('int:18~65');
  });
});
