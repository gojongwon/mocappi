/**
 * /schema/openapi — 스키마를 OpenAPI 3.1 로 내보내기.
 *
 * 핵심은 "레지스트리와 어긋나지 않는가" 다. 타입 판별을 생성 함수 실행으로 하는 이유가
 * 그것이라, 여기 검사도 손으로 만든 매핑표가 아니라 실제 응답과 대조한다.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const doc = async (qs: string) => {
  const res = await worker.fetch(new Request(BASE + '/schema/openapi' + qs));
  return { res, body: (await res.json()) as any };
};

const propsOf = (body: any) => Object.values(body.components.schemas)[0] as any;

describe('문서 뼈대', () => {
  it('3.1.0 · servers · 하나의 path', async () => {
    const { res, body } = await doc('?_res=users&id=uuid&name=person.fullName');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.openapi).toBe('3.1.0');
    expect(body.servers[0].url).toBe(BASE);
    expect(Object.keys(body.paths)).toEqual(['/api/users']);
    expect(body.components.schemas.User).toBeTruthy(); // users → User
  });

  it('언어 의존이라 캐시 금지', async () => {
    const { res } = await doc('?_res=users&id=uuid');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('필드 파라미터의 default 가 원래 DSL 그대로 — 임포트 직후 같은 URL 이 재현된다', async () => {
    const { body } = await doc('?_res=users&age=int:20~60&tags[]=lorem.word:3');
    const byName = Object.fromEntries(body.paths['/api/users'].get.parameters.map((p: any) => [p.name, p]));
    expect(byName['age'].schema.default).toBe('int:20~60');
    expect(byName['tags[]'].schema.default).toBe('lorem.word:3');
    expect(byName['_page'].schema.type).toBe('integer');
    expect(byName['_locale'].schema.type).toBe('string');
  });

  it('DSL 오류 → 400', async () => {
    const { res, body } = await doc('?_res=users&age=int:20-60');
    expect(res.status).toBe(400);
    expect(body.field).toBe('age');
  });
});

describe('타입 매핑', () => {
  it('int 는 integer, float 는 number — 표본 하나의 우연에 안 흔들린다', async () => {
    const { body } = await doc('?_res=x&a=int:20~60&b=float:0~100:2&c=bool&d=text:10');
    const p = propsOf(body).properties;
    expect(p.a.type).toBe('integer');
    expect(p.b.type).toBe('number');
    expect(p.c.type).toBe('boolean');
    expect(p.d.type).toBe('string');
  });

  it('nullable 은 3.1 방식으로 type 배열 (nullable:true 아님)', async () => {
    const { body } = await doc('?_res=x&email=internet.email?0.2');
    const p = propsOf(body).properties;
    expect(p.email.type).toEqual(['string', 'null']);
    expect(p.email.nullable).toBeUndefined();
  });

  it('enum 은 가중치를 떼고, const 는 const 로', async () => {
    const { body } = await doc('?_res=x&role=enum:paid*8|refund*2&kind=const:user');
    const p = propsOf(body).properties;
    expect(p.role.enum).toEqual(['paid', 'refund']);
    expect(p.kind.const).toBe('user');
  });

  it('중첩은 object, 배열은 길이까지', async () => {
    const { body } = await doc('?_res=x&address.city=location.city&tags[]=lorem.word:5');
    const p = propsOf(body).properties;
    expect(p.address.type).toBe('object');
    expect(p.address.properties.city.type).toBe('string');
    expect(p.tags.type).toBe('array');
    expect(p.tags.minItems).toBe(5);
    expect(p.tags.maxItems).toBe(5);
  });

  it('예시는 _locale 을 따른다 — 문서와 실제 응답이 같은 언어', async () => {
    const { body } = await doc('?_res=x&name=person.fullName&_locale=ko');
    expect(propsOf(body).properties.name.examples[0]).toMatch(/[가-힣]/);
  });
});

describe('_wrap · 메서드별 응답 모양', () => {
  it('envelope 기본 — data 배열 + 페이지 메타', async () => {
    const { body } = await doc('?_res=users&id=uuid');
    const schema = body.paths['/api/users'].get.responses['200'].content['application/json'].schema;
    expect(schema.properties.data.items.$ref).toBe('#/components/schemas/User');
    expect(schema.required).toContain('hasNext');
  });

  it('_wrap=none → 배열, _wrap=one → 단일 $ref', async () => {
    const none = await doc('?_res=users&id=uuid&_wrap=none');
    expect(none.body.paths['/api/users'].get.responses['200'].content['application/json'].schema.type).toBe('array');

    const one = await doc('?_res=users&id=uuid&_wrap=one');
    expect(one.body.paths['/api/users'].get.responses['200'].content['application/json'].schema.$ref)
      .toBe('#/components/schemas/User');
  });

  it('_method=post → post 오퍼레이션 + 201 단건', async () => {
    const { body } = await doc('?_res=users&id=uuid&_method=post');
    const op = body.paths['/api/users'].post;
    expect(op).toBeTruthy();
    expect(op.responses['201'].content['application/json'].schema.$ref).toBe('#/components/schemas/User');
  });

  it('_method=delete → 204 무본문', async () => {
    const { body } = await doc('?_res=users&id=uuid&_method=delete');
    expect(body.paths['/api/users'].delete.responses['204'].content).toBeUndefined();
  });
});

describe('문서가 실제 응답과 맞는가', () => {
  // 이 테스트가 openapi.ts 존재 이유다 — 문서만 예뻐지고 응답이 다르면 의미가 없다
  it('선언한 속성 집합이 /api 응답 아이템의 키와 일치한다', async () => {
    const qs = 'id=uuid&name=person.fullName&age=int:20~60&address.city=location.city&tags[]=lorem.word:3';
    const { body: spec } = await doc('?_res=users&' + qs);
    const data = (await (await worker.fetch(new Request(`${BASE}/api/users?${qs}&_limit=1`))).json()) as any;

    const declared = Object.keys(propsOf(spec).properties).sort();
    expect(Object.keys(data.data[0]).sort()).toEqual(declared);
  });

  it('envelope 키도 선언과 일치한다', async () => {
    const { body: spec } = await doc('?_res=users&id=uuid');
    const data = (await (await worker.fetch(new Request(`${BASE}/api/users?id=uuid`))).json()) as any;
    const schema = spec.paths['/api/users'].get.responses['200'].content['application/json'].schema;
    expect(Object.keys(data).sort()).toEqual(Object.keys(schema.properties).sort());
  });
});
