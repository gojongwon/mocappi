/**
 * pk / ref — 리소스 간 관계.
 * 핵심 계약: 서로를 모르는 두 URL 이 (리소스 이름, 인덱스)만으로 같은 값을 낸다.
 */
import { describe, expect, it } from 'vitest';
import { compileType, DslError, type GenContext } from '../src/registry';
import worker from '../src/index';

const BASE = 'https://mock.test';
const ctx = (globalIndex: number, locale: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): GenContext => ({ globalIndex, locale });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('pk', () => {
  const pk = compileType('pk:users');

  it('(리소스, 인덱스)가 같으면 필드 시드·로케일이 달라도 같은 uuid', () => {
    // 필드 시드는 스키마 전체(normalized)에 좌우된다 — pk 가 그걸 쓰면
    // 스키마에 필드 하나만 더해도 모든 관계가 끊긴다. 그래서 시드를 버려야 한다.
    expect(pk(111, ctx(7))).toBe(pk(999, ctx(7, 'en')));
    expect(pk(0, ctx(7))).toMatch(UUID_RE);
  });

  it('인덱스가 다르면 다른 값, 리소스가 다르면 다른 값', () => {
    expect(pk(1, ctx(0))).not.toBe(pk(1, ctx(1)));
    expect(pk(1, ctx(0))).not.toBe(compileType('pk:products')(1, ctx(0)));
  });

  it('이름 누락/규칙 위반 → DslError + 힌트', () => {
    expect(() => compileType('pk')).toThrowError(DslError);
    expect(() => compileType('pk:')).toThrowError(DslError);
    expect(() => compileType('pk:한글')).toThrowError(DslError);
  });
});

describe('ref', () => {
  it('ref 값은 대상 리소스 앞 <총원>개의 pk 안에만 있다', () => {
    const pk = compileType('pk:users');
    const domain = new Set(Array.from({ length: 50 }, (_, i) => pk(0, ctx(i))));
    const ref = compileType('ref:users:50');
    for (let s = 0; s < 200; s++) expect(domain.has(ref(s, ctx(s)) as string)).toBe(true);
  });

  it('총원 기본값은 100 — _total 기본값과 같다', () => {
    const pk = compileType('pk:users');
    const domain = new Set(Array.from({ length: 100 }, (_, i) => pk(0, ctx(i))));
    const ref = compileType('ref:users');
    const picked = new Set<string>();
    for (let s = 0; s < 300; s++) picked.add(ref(s, ctx(s)) as string);
    for (const v of picked) expect(domain.has(v)).toBe(true);
    expect(picked.size).toBeGreaterThan(10); // 한 값에 뭉치지 않는다
  });

  it('같은 필드 시드면 같은 선택 — 결정적', () => {
    const ref = compileType('ref:users');
    expect(ref(42, ctx(3))).toBe(ref(42, ctx(3)));
  });

  it('nullable 수식자와 조합된다 — ref:users?0.5', () => {
    const ref = compileType('ref:users?0.5');
    const vals = Array.from({ length: 60 }, (_, s) => ref(s, ctx(s)));
    expect(vals.some((v) => v === null)).toBe(true);
    expect(vals.some((v) => typeof v === 'string' && UUID_RE.test(v))).toBe(true);
  });

  it('총원 0/음수/비정수 → DslError', () => {
    expect(() => compileType('ref:users:0')).toThrowError(DslError);
    expect(() => compileType('ref:users:abc')).toThrowError(DslError);
    expect(() => compileType('ref:users:1:2')).toThrowError(DslError);
  });
});

describe('워커 레벨 — 두 API 의 관계가 실제로 맞물린다', () => {
  it('orders.userId ⊆ users.id, 서로 다른 스키마·옵션에서도', async () => {
    // users: pk 외에 아무 필드나 더 있어도 관계는 유지되어야 한다
    const usersRes = await worker.fetch(
      new Request(`${BASE}/api/users?id=pk:users&name=person.fullName&_limit=100&_wrap=none`),
    );
    const users = (await usersRes.json()) as Array<{ id: string }>;
    const ids = new Set(users.map((u) => u.id));
    expect(ids.size).toBe(100);

    const ordersRes = await worker.fetch(
      new Request(`${BASE}/api/orders?id=uuid&userId=ref:users&amount=int:1000~90000&_limit=50&_wrap=none&_locale=en`),
    );
    const orders = (await ordersRes.json()) as Array<{ userId: string }>;
    for (const o of orders) expect(ids.has(o.userId)).toBe(true);
  });

  it('페이지를 넘겨도 pk 는 전역 인덱스를 따른다', async () => {
    const p1 = (await (await worker.fetch(new Request(`${BASE}/api/users?id=pk:users&_limit=10&_wrap=none`))).json()) as Array<{ id: string }>;
    const p2 = (await (await worker.fetch(new Request(`${BASE}/api/users?id=pk:users&_limit=5&_page=2&_wrap=none`))).json()) as Array<{ id: string }>;
    expect(p2[0].id).toBe(p1[5].id); // 전역 5번 항목
  });

  it('/schema/types 의 dslTypes 에 pk·ref 가 있다', async () => {
    const res = await worker.fetch(new Request(`${BASE}/schema/types`));
    const body = (await res.json()) as { dslTypes: Array<{ type: string }> };
    expect(body.dslTypes.some((d) => d.type === 'pk')).toBe(true);
    expect(body.dslTypes.some((d) => d.type === 'ref')).toBe(true);
  });
});
