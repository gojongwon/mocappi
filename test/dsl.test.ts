import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/dsl';
import { generateResponse, type Envelope } from '../src/generate';
import { DslError, TYPE_DOCS, compileType } from '../src/registry';

function run(qs: string): Envelope {
  return generateResponse(parseQuery(new URLSearchParams(qs))) as Envelope;
}

function firstItem(qs: string): Record<string, unknown> {
  return run(qs + '&_limit=1').data[0] as Record<string, unknown>;
}

function errorOf(qs: string): DslError {
  try {
    parseQuery(new URLSearchParams(qs));
  } catch (e) {
    if (e instanceof DslError) return e;
    throw e;
  }
  throw new Error('DslError 가 발생해야 하는데 발생하지 않음: ' + qs);
}

describe('DSL 필드 타입', () => {
  it('int 범위', () => {
    const r = run(`age=int:20~60&_limit=100&_total=100`);
    for (const d of r.data as Array<{ age: number }>) {
      expect(Number.isInteger(d.age)).toBe(true);
      expect(d.age).toBeGreaterThanOrEqual(20);
      expect(d.age).toBeLessThanOrEqual(60);
    }
  });

  it('float 범위 + 자릿수', () => {
    const r = run(`price=float:0~100:2&_limit=100`);
    for (const d of r.data as Array<{ price: number }>) {
      expect(d.price).toBeGreaterThanOrEqual(0);
      expect(d.price).toBeLessThanOrEqual(100);
      expect(String(d.price).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it('bool 확률', () => {
    const r = run(`active=bool:0.8&_limit=100&_total=100`);
    const trues = (r.data as Array<{ active: boolean }>).filter((d) => d.active).length;
    expect(trues).toBeGreaterThan(60); // 0.8 근처
    expect(trues).toBeLessThan(97);
  });

  it('enum', () => {
    const r = run(`role=enum:admin|user|guest&_limit=50`);
    for (const d of r.data as Array<{ role: string }>) {
      expect(['admin', 'user', 'guest']).toContain(d.role);
    }
  });

  it('const (콜론 포함 값 유지)', () => {
    expect(firstItem(`type=const:user`).type).toBe('user');
    expect(firstItem(`u=const:a:b`).u).toBe('a:b');
  });

  it('text 길이', () => {
    expect(String(firstItem(`bio=text:50`).bio)).toHaveLength(50);
  });

  it('image URL', () => {
    expect(String(firstItem(`avatar=image:200x200`).avatar)).toMatch(/^https:\/\/picsum\.photos\/seed\/[a-z0-9]+\/200\/200$/);
  });

  it('date 범위 (ISO)', () => {
    const v = String(firstItem(`createdAt=date:2020-01-01~2024-12-31`).createdAt);
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(v)).toBeGreaterThanOrEqual(Date.parse('2020-01-01T00:00:00Z'));
    expect(Date.parse(v)).toBeLessThanOrEqual(Date.parse('2025-01-01T00:00:00Z'));
  });

  it('uuid 형식', () => {
    expect(String(firstItem(`id=uuid`).id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('index = 전역 인덱스', () => {
    const r = run(`seq=index&_limit=10&_page=3&_total=100`);
    expect((r.data as Array<{ seq: number }>).map((d) => d.seq)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });
});

describe('중첩 / 배열', () => {
  it('중첩 3단계', () => {
    const item = firstItem(`a.b.c=const:deep&a.b.d=int:1~1&a.e=const:mid`);
    expect(item).toEqual({ a: { b: { c: 'deep', d: 1 }, e: 'mid' } });
  });

  it('배열 길이 지정', () => {
    const item = firstItem(`tags[]=lorem.word:3`);
    expect(Array.isArray(item.tags)).toBe(true);
    expect(item.tags).toHaveLength(3);
  });

  it('배열 길이 기본값 3', () => {
    expect(firstItem(`tags[]=lorem.word`).tags).toHaveLength(3);
  });

  it('배열 항목들이 서로 다른 시드를 씀', () => {
    const nums = firstItem(`nums[]=int:0~1000000:10`).nums as number[];
    expect(new Set(nums).size).toBeGreaterThan(1);
  });

  it('중첩 + 배열 조합', () => {
    const item = firstItem(`meta.tags[]=lorem.word:2&meta.count=int:5~5`);
    const meta = item.meta as { tags: string[]; count: number };
    expect(meta.tags).toHaveLength(2);
    expect(meta.count).toBe(5);
  });
});

describe('에러 응답 (400)', () => {
  it("잘못된 범위 구분자 → '~' 힌트 (계획서 예시)", () => {
    const e = errorOf(`age=int:20-60`);
    expect(e.info.field).toBe('age');
    expect(e.info.value).toBe('int:20-60');
    expect(e.info.hint).toContain('~');
    expect(e.info.hint).toContain('int:20~60');
  });

  it('알 수 없는 타입 → 필드명 + 힌트', () => {
    const e = errorOf(`age=integer`);
    expect(e.info.error).toBe('Unknown field type');
    expect(e.info.field).toBe('age');
    expect(e.info.hint).toContain('int');
  });

  it('알 수 없는 faker 경로', () => {
    const e = errorOf(`x=person.nope`);
    expect(e.info.error).toBe('Unknown faker path');
    expect(e.info.hint).toContain('/schema/types');
  });

  it('예약어 이름의 필드 시도 → 명확한 에러', () => {
    const e = errorOf(`_mine=uuid&id=uuid`);
    expect(e.info.error).toBe('Unknown reserved parameter');
    expect(e.info.hint).toContain('예약어');
  });

  it('타입 없는 필드', () => {
    const e = errorOf(`name=`);
    expect(e.info.error).toBe('Missing field type');
    expect(e.info.field).toBe('name');
  });

  it('중복 파라미터', () => {
    expect(errorOf(`id=uuid&id=uuid`).info.error).toBe('Duplicate parameter');
  });

  it('필드 0개', () => {
    expect(errorOf(`_page=1`).info.error).toBe('No fields defined');
  });

  it('경로 충돌 (a 가 값이면서 a.b 의 부모)', () => {
    expect(errorOf(`a=int:1~5&a.b=uuid`).info.error).toBe('Field path conflict');
  });

  it('잘못된 예약 파라미터 값', () => {
    expect(errorOf(`id=uuid&_locale=jp`).info.field).toBe('_locale');
    expect(errorOf(`id=uuid&_page=0`).info.field).toBe('_page');
    expect(errorOf(`id=uuid&_status=999`).info.field).toBe('_status');
  });

  it('위험한 faker 경로 차단', () => {
    expect(errorOf(`x=helpers.fake`).info.error).toBe('Unknown faker path');
    expect(errorOf(`x=a.b.c.d`).info.error).toBe('Invalid faker path'); // 2단계 초과
  });
});

describe('/schema/types 큐레이션 무결성', () => {
  it('문서의 모든 faker 경로가 실제로 컴파일·생성 가능', () => {
    for (const p of TYPE_DOCS.fakerPaths) {
      const gen = compileType(p.value);
      for (const locale of ['ko', 'en'] as const) {
        const v = gen(12345, { globalIndex: 0, locale });
        expect(v, `${p.value} (${locale})`).not.toBeUndefined();
      }
    }
  });

  it('문서의 모든 DSL 예시가 컴파일 가능', () => {
    for (const t of TYPE_DOCS.dslTypes) {
      expect(() => compileType(t.example), t.example).not.toThrow();
    }
  });
});
