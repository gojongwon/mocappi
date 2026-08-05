/**
 * OpenAPI 문서 → 스키마 추론.
 * 문서 감지·$ref/allOf/nullable 해석·format 매핑·오퍼레이션 선택,
 * 그리고 /schema/infer 가 예시 JSON 과 OpenAPI 를 한 입구에서 가르는지.
 */
import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/dsl';
import { inferFromOpenApi, isOpenApiDoc } from '../src/infer-openapi';
import { generateOpenApi } from '../src/openapi';
import worker from '../src/index';

const BASE = 'https://mock.test';
const post = (body: unknown, lang?: string) =>
  worker.fetch(
    new Request(BASE + '/schema/infer', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(lang ? { 'accept-language': lang } : {}) },
    }),
  );

/** 3.1 문서 — envelope + $ref + format + enum + nullable + 객체 배열 */
const DOC_31 = {
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {
    '/users': {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'email'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 18, maximum: 65 },
          status: { type: 'string', enum: ['active', 'banned'] },
          bio: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
          orders: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
          address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'string' } } },
        },
      },
    },
  },
};

describe('isOpenApiDoc', () => {
  it('openapi/swagger 버전 + paths 가 있어야 문서', () => {
    expect(isOpenApiDoc(DOC_31)).toBe(true);
    expect(isOpenApiDoc({ swagger: '2.0', paths: {} })).toBe(true);
    expect(isOpenApiDoc({ openapi: '3.1.0' })).toBe(false); // paths 없음
    expect(isOpenApiDoc({ paths: {} })).toBe(false); // 버전 없음
    expect(isOpenApiDoc({ name: '김민준', age: 34 })).toBe(false); // 평범한 예시 JSON
  });
});

describe('inferFromOpenApi', () => {
  const result = inferFromOpenApi(DOC_31);
  const types = Object.fromEntries(result.fields.map((f) => [f.name, f.type]));

  it('envelope 을 벗기고 $ref 를 해석해 항목 필드를 얻는다', () => {
    expect(types.id).toBe('uuid');
    expect(types.email).toBe('internet.email');
  });

  it('format·enum·범위·중첩·스칼라 배열 매핑', () => {
    expect(types.age).toBe('int:18~65');
    expect(types.status).toBe('enum:active|banned');
    expect(types.createdAt).toMatch(/^date:/);
    expect(types['tags[]']).toMatch(/^lorem\.word/);
    expect(types['address.city']).toBe('location.city');
    expect(types['address.zip']).toBe('location.zipCode');
  });

  it('3.1 type 배열의 null → ?0.2', () => {
    expect(types.bio).toMatch(/\?0\.2$/);
  });

  it('객체 배열은 skipped 로 이유와 함께', () => {
    expect(result.fields.find((f) => f.name.startsWith('orders'))).toBeUndefined();
    expect(result.skipped.some((s) => s.path === 'orders')).toBe(true);
  });

  it('목록다운 GET 을 고르고, 무시한 오퍼레이션 수를 note 로 알린다', () => {
    expect(result.note).toContain('GET /users');
    expect(result.note).toContain('1');
  });

  it('경로에서 리소스 이름을 추출한다', () => {
    expect(result.res).toBe('users');
  });

  it('모든 변환 결과가 실제로 컴파일된다 — /api 에 넣으면 200', async () => {
    const qs = result.fields.map((f) => `${f.name}=${encodeURIComponent(f.type)}`).join('&');
    const res = await worker.fetch(new Request(`${BASE}/api/${result.res}?${qs}&_limit=2`));
    expect(res.status).toBe(200);
  });

  it('3.0 nullable: true 와 allOf 병합', () => {
    const doc = {
      openapi: '3.0.3',
      paths: {
        '/pets/{id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        { $ref: '#/components/schemas/Base' },
                        { type: 'object', properties: { nickname: { type: 'string', nullable: true } } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Base: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } },
    };
    const r = inferFromOpenApi(doc);
    const t = Object.fromEntries(r.fields.map((f) => [f.name, f.type]));
    expect(t.id).toBe('uuid');
    expect(t.nickname).toMatch(/\?0\.2$/);
    expect(r.res).toBe('pets'); // {id} 는 건너뛰고 pets
  });

  it('Swagger 2.0 — definitions + 응답 직속 schema', () => {
    const doc = {
      swagger: '2.0',
      paths: {
        '/orders': {
          get: {
            responses: { '200': { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/Order' } } } },
          },
        },
      },
      definitions: {
        Order: { type: 'object', properties: { id: { type: 'integer' }, price: { type: 'number', minimum: 0, maximum: 90000 } } },
      },
    };
    const t = Object.fromEntries(inferFromOpenApi(doc).fields.map((f) => [f.name, f.type]));
    expect(t.id).toBe('index');
    expect(t.price).toBe('float:0~90000:2');
  });

  it('순환 $ref 는 무한 재귀 없이 skipped', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/nodes': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } },
        },
      },
      components: {
        schemas: {
          Node: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, parent: { $ref: '#/components/schemas/Node' } } },
        },
      },
    };
    const r = inferFromOpenApi(doc);
    expect(r.fields.some((f) => f.name === 'id')).toBe(true);
    expect(r.skipped.some((s) => s.path === 'parent')).toBe(true);
  });

  it('예시 값이 선언보다 구체적이면 예시를 쓴다', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { code: { type: 'string', example: 'a3f9c2e1-72b4-4d1e-9c0a-5b6e7f8a9b0c' } } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const t = Object.fromEntries(inferFromOpenApi(doc).fields.map((f) => [f.name, f.type]));
    expect(t.code).toBe('uuid');
  });

  it('JSON 응답 스키마가 하나도 없으면 DslError', () => {
    expect(() => inferFromOpenApi({ openapi: '3.1.0', paths: { '/x': { get: { responses: { '204': { description: 'no content' } } } } } }))
      .toThrowError(/No importable operation/);
  });
});

describe('내보내기 ↔ 가져오기 왕복', () => {
  it('주문 상세 프리셋 — 스칼라 items[] 를 목록 껍데기로 오인하지 않는다', () => {
    // GUI orders 프리셋 그대로 (v1.0.0 실사용 회귀: items[] 가 WRAP_KEYS 의
    // 'items' 와 이름이 겹쳐 문자열 배열인데 envelope 로 벗겨져 400 이 났다)
    const q = parseQuery(new URLSearchParams([
      ['orderNo', 'pattern:ORD-2026-######'],
      ['status', 'enum:paid*5|shipped*3|delivered*4|cancelled*1'],
      ['amount', 'int:9000~450000'],
      ['paidAt', 'date:2026-01-01~2026-07-29'],
      ['customer.name', 'person.fullName'],
      ['customer.tel', 'phone.number'],
      ['customer.email', 'internet.email'],
      ['shipping.city', 'location.city'],
      ['shipping.street', 'location.streetAddress'],
      ['items[]', 'commerce.productName:3'],
      ['memo', 'text:40?0.3'],
      ['_wrap', 'one'],
      ['_seed', '1024'],
    ]));
    const doc = generateOpenApi(q, 'orders/1024', 'https://mock.test');
    const r = inferFromOpenApi(doc);
    const t = Object.fromEntries(r.fields.map((f) => [f.name, f.type]));
    expect(t['customer.name']).toBe('person.fullName');
    expect(t['customer.email']).toBe('internet.email');
    expect(t['items[]']).toMatch(/:3$/); // 스칼라 배열은 껍데기가 아니라 필드다
    expect(t.memo).toMatch(/\?0\.2$/); // nullable 왕복
    expect(r.res).toBe('orders'); // '1024' 는 숫자 세그먼트라 건너뛴다
  });

  it('users 목록 (envelope) — 진짜 껍데기는 여전히 벗긴다', () => {
    const q = parseQuery(new URLSearchParams('id=uuid&name=person.fullName&age=int:20~60'));
    const doc = generateOpenApi(q, 'users', 'https://mock.test');
    const t = Object.fromEntries(inferFromOpenApi(doc).fields.map((f) => [f.name, f.type]));
    expect(t.id).toBe('uuid');
    expect(t.name).toBe('person.fullName');
    expect(t.data).toBeUndefined(); // envelope 키가 필드로 새지 않는다
  });
});

describe('POST /schema/infer 라우트 분기', () => {
  it('OpenAPI 문서 → 스펙 임포트 (res 포함)', async () => {
    const res = await post(DOC_31);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Array<{ name: string; type: string }>; res?: string; note?: string };
    expect(body.res).toBe('users');
    expect(body.fields.some((f) => f.type === 'uuid')).toBe(true);
  });

  it('평범한 예시 JSON 은 기존 추론 그대로 (회귀 방지)', async () => {
    const res = await post({ name: '김민준', email: 'a@b.co' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Array<{ name: string; type: string }> };
    const t = Object.fromEntries(body.fields.map((f) => [f.name, f.type]));
    expect(t.name).toBe('person.fullName');
  });

  it('Accept-Language: en → note 도 영어', async () => {
    const res = await post(DOC_31, 'en');
    const body = (await res.json()) as { note?: string };
    expect(body.note).toContain('Imported');
  });

  it('스키마 없는 문서 → 400 + 영어 힌트', async () => {
    const res = await post({ openapi: '3.1.0', paths: {} }, 'en');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('OpenAPI');
  });
});
