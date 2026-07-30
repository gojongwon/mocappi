/**
 * 추론 — 마스킹된 값 자동 감지 (mask.name / mask.email / mask.phone / mask.card)
 */
import { describe, it, expect } from 'vitest';
import { inferSchema } from '../src/infer';
import { compileType } from '../src/registry';

const typeOf = (r: ReturnType<typeof inferSchema>, name: string) =>
  r.fields.find((f) => f.name === name)?.type;

describe('마스킹 값 감지', () => {
  it('CJK 마스킹 이름 → mask.name', () => {
    const names = ['김*준', '이*', '박*수', '최**희'];
    const r = inferSchema({ data: names.map((n) => ({ id: 1, customer: n })) });
    expect(typeOf(r, 'customer')).toBe('mask.name');
  });

  it('라틴 마스킹 이름 (J*** Smith) → mask.name', () => {
    const r = inferSchema({ owner: 'J*** Smith' });
    expect(typeOf(r, 'owner')).toBe('mask.name');
  });

  it('마스킹 이메일 → mask.email (email 키보다 우선)', () => {
    const r = inferSchema({ email: 'mi***@example.com' });
    expect(typeOf(r, 'email')).toBe('mask.email');
  });

  it('마스킹 전화 — 하이픈/괄호/무구분 모두 → mask.phone', () => {
    for (const tel of ['010-****-5678', '(212) ***-0187', '139****5678']) {
      const r = inferSchema({ contact: tel });
      expect(typeOf(r, 'contact'), tel).toBe('mask.phone');
    }
  });

  it('마스킹 카드번호 → mask.card (phone 으로 오검출 금지)', () => {
    const r = inferSchema({ payment: '****-****-****-4821' });
    expect(typeOf(r, 'payment')).toBe('mask.card');
  });

  it('반복돼도 enum 으로 승격되지 않는다', () => {
    const r = inferSchema({ data: Array.from({ length: 8 }, () => ({ id: 1, who: '김*준' })) });
    expect(typeOf(r, 'who')).toBe('mask.name');
  });

  it('null 섞이면 nullable 수식자와 조합된다', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, who: i < 5 ? '김*준' : null }));
    const r = inferSchema({ data: items });
    expect(typeOf(r, 'who')).toBe('mask.name?0.5');
  });

  it('별표가 있어도 마스킹 형태가 아니면 오검출하지 않는다', () => {
    const r = inferSchema({ formula: '5*3', note: 'a**b' });
    expect(typeOf(r, 'formula')).not.toMatch(/^mask\./);
    expect(typeOf(r, 'note')).not.toMatch(/^mask\./);
  });

  it('감지된 모든 mask 타입은 compileType 을 통과한다', () => {
    const r = inferSchema({
      data: [
        { who: '김*준', mail: 'mi***@example.com', tel: '010-****-5678', card: '****-****-****-4821' },
        { who: '박*수', mail: 'jo***@example.com', tel: '010-****-1234', card: '****-****-****-0921' },
      ],
    });
    for (const f of r.fields) expect(() => compileType(f.type)).not.toThrow();
    expect(r.fields.filter((f) => f.type.startsWith('mask.')).length).toBe(4);
  });
});
