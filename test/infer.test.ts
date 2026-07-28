import { describe, expect, it } from 'vitest';
import { inferSchema } from '../src/infer';
import { DslError, compileType } from '../src/registry';

function typesOf(input: unknown): Record<string, string> {
  const r = inferSchema(input);
  return Object.fromEntries(r.fields.map((f) => [f.name, f.type]));
}

describe('스키마 추론', () => {
  it('대표 응답 예시 — 값/키 기반 추론', () => {
    const t = typesOf({
      id: '566fc9cf-139a-4986-9f60-dc89dec543f3',
      name: '김민준',
      email: 'minjun@example.com',
      age: 34,
      active: true,
      score: 87.5,
      avatar: 'https://picsum.photos/seed/x/200/200',
      homepage: 'https://deep-medi.com',
      createdAt: '2025-03-14T09:00:00.000Z',
      bio: '안녕하세요. 백엔드 개발자입니다.',
    });
    expect(t.id).toBe('uuid');
    expect(t.name).toBe('person.fullName');
    expect(t.email).toBe('internet.email');
    expect(t.age).toBe('int:18~65');
    expect(t.active).toBe('bool');
    expect(t.score).toMatch(/^float:0~100:\d$/);
    expect(t.avatar).toBe('image:200x200');
    expect(t.homepage).toBe('internet.url');
    expect(t.createdAt).toBe('date:2025-01-01~2025-12-31');
    expect(t.bio).toMatch(/^text:\d+$/);
  });

  it('envelope 자동 언랩 ({data: [...]}, 배열 루트)', () => {
    const item = { id: 1, city: '서울' };
    expect(typesOf({ data: [item], page: 1 })).toEqual(typesOf(item));
    expect(typesOf([item, item])).toEqual(typesOf(item));
    expect(typesOf({ items: [item] })).toEqual(typesOf(item));
  });

  it('숫자 id → index, 큰 정수 → 타임스탬프 추정', () => {
    const t = typesOf({ id: 42, ts: 1710000000000, price: 12900 });
    expect(t.id).toBe('index');
    expect(t.ts).toMatch(/^date:/);
    expect(t.price).toBe('int:0~50000');
  });

  it('enum 성 키 (status/role/…) → enum:값', () => {
    const t = typesOf({ status: 'shipped', role: 'admin' });
    expect(t.status).toBe('enum:shipped');
    expect(t.role).toBe('enum:admin');
  });

  it('중첩 객체 → 점 표기법', () => {
    const t = typesOf({ customer: { name: '박서연', address: { city: '부산', zip: '48058' } } });
    expect(t['customer.name']).toBe('person.fullName');
    expect(t['customer.address.city']).toBe('location.city');
    expect(t['customer.address.zip']).toBe('location.zipCode');
  });

  it('스칼라 배열 → 이름[] + 길이', () => {
    const t = typesOf({ tags: ['red', 'blue'], scores: [1, 2, 3] });
    expect(t['tags[]']).toBe('lorem.word:2');
    expect(t['scores[]']).toMatch(/^int:0~10:3$/);
  });

  it('skipped — 객체 배열 / null / 빈 배열 / 잘못된 키', () => {
    const r = inferSchema({ ok: 1, orders: [{ a: 1 }], gone: null, empty: [], '한글키': 1 });
    expect(r.fields.map((f) => f.name)).toEqual(['ok']);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));
    expect(reasons['orders']).toContain('객체 배열');
    expect(reasons['gone']).toContain('null');
    expect(reasons['empty']).toContain('빈 배열');
    expect(reasons['한글키']).toContain('필드명 규칙');
  });

  it('추론 불가 입력 → DslError + 힌트', () => {
    for (const bad of ['문자열', 123, [], [1, 2], null]) {
      expect(() => inferSchema(bad), JSON.stringify(bad)).toThrow(DslError);
    }
  });

  it('추론된 모든 타입은 실제로 컴파일된다', () => {
    const r = inferSchema({
      id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
      n: '홍길동', e: 'a@b.co', age: 30, ok: true, p: 3.14,
      img: 'https://x.co/a.png', u: 'https://x.co', d: '2024-05-05',
      s: 'pending', w: 'word', long: 'gap 있는 조금 긴 문자열입니다',
      nest: { z: 1 }, arr: ['a', 'b'],
    });
    for (const f of r.fields) {
      const t = f.name.endsWith('[]') ? f.type.replace(/:\d+$/, '') : f.type;
      expect(() => compileType(t), `${f.name}=${f.type}`).not.toThrow();
    }
  });
});
