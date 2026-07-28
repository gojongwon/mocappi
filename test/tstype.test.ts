import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/dsl';
import { generateTsTypes, interfaceName } from '../src/tstype';
import worker from '../src/index';

function gen(qs: string, resource = 'users', wrap: 'envelope' | 'none' = 'envelope'): string {
  const q = parseQuery(new URLSearchParams(qs));
  return generateTsTypes(q.fields, resource, wrap);
}

describe('TypeScript 타입 생성', () => {
  it('interface 이름 — 단순 복수형 처리', () => {
    expect(interfaceName('users')).toBe('User');
    expect(interfaceName('products')).toBe('Product');
    expect(interfaceName('order_items')).toBe('Orderitem');
    expect(interfaceName('address')).toBe('Address'); // ss 로 끝나면 유지
    expect(interfaceName('')).toBe('Item');
  });

  it('스칼라 타입 매핑', () => {
    const ts = gen('id=uuid&name=person.fullName&age=int:20~60&score=float:0~1:2&active=bool&seq=index&createdAt=date:2024-01-01~2025-12-31');
    expect(ts).toContain('export interface User {');
    expect(ts).toContain('id: string;');
    expect(ts).toContain('name: string;');
    expect(ts).toContain('age: number;');
    expect(ts).toContain('score: number;');
    expect(ts).toContain('active: boolean;');
    expect(ts).toContain('seq: number;');
    expect(ts).toContain('createdAt: string;');
  });

  it('enum → 리터럴 유니언, const → 리터럴', () => {
    const ts = gen('role=enum:admin|user|guest&version=const:v1');
    expect(ts).toContain("role: 'admin' | 'user' | 'guest';");
    expect(ts).toContain("version: 'v1';");
  });

  it('중첩 객체 → 중첩 타입', () => {
    const ts = gen('customer.name=person.fullName&customer.address.city=location.city&customer.age=int:20~60');
    expect(ts).toMatch(/customer: \{[\s\S]*address: \{[\s\S]*city: string;[\s\S]*\};[\s\S]*\};/);
  });

  it('배열 — 유니언은 괄호로 감싼다', () => {
    const ts = gen('tags[]=lorem.word:3&states[]=enum:on|off:2');
    expect(ts).toContain('tags: string[];');
    expect(ts).toContain("states: ('on' | 'off')[];");
  });

  it('envelope — Paginated<T> + fetchMock 헬퍼 포함', () => {
    const ts = gen('id=uuid');
    expect(ts).toContain('export interface Paginated<T>');
    expect(ts).toContain('export async function fetchMock<T>');
    expect(ts).toContain('fetchMock<User>');
  });

  it('_wrap=none — 배열 안내만', () => {
    const ts = gen('id=uuid', 'users', 'none');
    expect(ts).toContain('User[]');
    expect(ts).not.toContain('Paginated');
  });
});

describe('GET /schema/ts', () => {
  const BASE = 'https://mock.test';

  it('text/plain 으로 타입 코드 반환', async () => {
    const res = await worker.fetch(new Request(BASE + '/schema/ts?_res=orders&id=uuid&status=enum:paid|pending&amount=int:1000~9000'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const ts = await res.text();
    expect(ts).toContain('export interface Order {');
    expect(ts).toContain("status: 'paid' | 'pending';");
  });

  it('잘못된 DSL → 400 + 힌트', async () => {
    const res = await worker.fetch(new Request(BASE + '/schema/ts?_res=users&age=int:20-60'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { hint: string }).hint).toContain('~');
  });
});
