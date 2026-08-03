/**
 * 스키마 → OpenAPI 3.1 문서.
 *
 * /schema/ts 와 입력이 같다 (ParsedQuery + 리소스명). tstype.ts 가 같은 트리를 걸어
 * TS 코드를 뱉는다면 여기는 JSON Schema 를 뱉는다 — 다른 건 방출 형식뿐이라
 * 트리 조립·배열 분리·타입 판별 기법을 전부 tstype.ts 에서 가져다 쓴다.
 *
 * 이걸 내보내는 이유: /schema/ts 는 TypeScript 전용이다. OpenAPI 면 Postman·Insomnia
 * 임포트와 모든 언어의 클라이언트 코드젠이 그냥 붙는다.
 */
import type { FieldSpec, ParsedQuery } from './dsl';
import { compileType, NULLABLE_RE, typeDocsFor, type Generator, type Locale } from './registry';
import { buildTree, interfaceName, itemTypeRawOf, type Tree } from './tstype';

type JsonSchema = Record<string, unknown>;

/** 정수 파라미터 — 나머지 예약어는 전부 문자열로 나간다 */
const INT_PARAMS = new Set(['_page', '_limit', '_total', '_delay', '_status']);

/**
 * 값 타입 판별은 tstype.ts 와 같은 수법이다 — 생성 함수를 실제로 돌려서 본다.
 * 레지스트리에 타입이 늘어도 여기가 어긋날 수 없는 게 요점이라 직접 매핑을 만들지 말 것.
 *
 * integer/number 만 표본 하나로는 못 가른다: float:0~100:2 가 우연히 42 를 내면
 * 정수로 오판하고, 그 오판이 생성된 클라이언트의 필드 타입까지 간다. 그래서 여러 번 본다.
 */
const PROBE_SEEDS = [12345, 777, 20260803, 42, 999983];

function probe(gen: Generator, locale: Locale): unknown[] {
  return PROBE_SEEDS.map((s, i) => gen(s, { globalIndex: i, locale }));
}

function schemaOfRaw(raw: string, gen: Generator, locale: Locale): JsonSchema {
  // nullable 수식자 — 3.1 은 nullable:true 가 아니라 type 배열로 넓힌다.
  // 샘플은 내부 생성기로 뽑는다 (nullable 생성기는 시드에 따라 null 이 나와 판별이 흔들린다).
  const nm = raw.match(NULLABLE_RE);
  if (nm) {
    const inner = schemaOfRaw(nm[1], compileType(nm[1]), locale);
    const t = inner.type;
    if (t === undefined) return inner; // const: 처럼 type 이 없는 경우는 그대로
    return { ...inner, type: Array.isArray(t) ? [...t, 'null'] : [t, 'null'] };
  }
  if (raw.startsWith('enum:')) {
    // 가중치(*8)는 값이 아니라 확률이라 떼고 넣는다 — tstype.ts 와 같은 처리
    return { type: 'string', enum: raw.slice(5).split('|').map((v) => v.replace(/\*\d+(?:\.\d+)?$/, '')) };
  }
  if (raw.startsWith('const:')) {
    return { const: raw.slice(6) };
  }

  const samples = probe(gen, locale);
  const first = samples[0];
  switch (typeof first) {
    case 'number':
      return {
        type: samples.every((s) => Number.isInteger(s)) ? 'integer' : 'number',
        examples: [first],
      };
    case 'boolean':
      return { type: 'boolean', examples: [first] };
    case 'string':
      return { type: 'string', examples: [first] };
    case 'object':
      return first === null ? { type: 'null' } : { type: 'object', additionalProperties: true };
    default:
      return {};
  }
}

function schemaOfField(f: FieldSpec, locale: Locale): JsonSchema {
  const item = schemaOfRaw(itemTypeRawOf(f), f.gen, locale);
  return f.isArray ? { type: 'array', items: item, minItems: f.arrayLen, maxItems: f.arrayLen } : item;
}

function emitNode(node: Tree, locale: Locale): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of node) {
    properties[k] = v instanceof Map ? emitNode(v, locale) : schemaOfField(v, locale);
  }
  // 목 API 는 모든 필드를 항상 채운다 — nullable 도 키 자체는 있다
  return { type: 'object', properties, required: Object.keys(properties) };
}

/** envelope 응답 — generate.ts 의 Envelope 와 키가 1:1 이어야 한다 */
function envelopeSchema(ref: string): JsonSchema {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: ref } },
      page: { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      totalPages: { type: 'integer' },
      hasNext: { type: 'boolean' },
      hasPrev: { type: 'boolean' },
    },
    required: ['data', 'page', 'limit', 'total', 'totalPages', 'hasNext', 'hasPrev'],
  };
}

/** 예약 파라미터는 /schema/types 의 문서를 그대로 쓴다 — 설명이 두 군데로 갈라지지 않게 */
function reservedParams(lang: 'ko' | 'en'): JsonSchema[] {
  const label = lang === 'en' ? 'default' : '기본';
  return typeDocsFor(lang).reserved.map((r) => ({
    name: r.name,
    in: 'query',
    required: false,
    description: r.default === '—' ? r.desc : `${r.desc} (${label}: ${r.default})`,
    schema: { type: INT_PARAMS.has(r.name) ? 'integer' : 'string' },
  }));
}

/**
 * 필드 파라미터 — 현재 값을 default 로 넣어야 임포트 직후 그대로 호출된다.
 * required 인 건 문법이 아니라 의도다: 빼면 그 필드가 응답에서 사라지므로
 * Postman 이 기본으로 포함하게 둬야 문서가 가리키는 응답이 실제로 나온다.
 */
function fieldParams(fields: FieldSpec[], lang: 'ko' | 'en'): JsonSchema[] {
  return fields.map((f) => ({
    name: f.name,
    in: 'query',
    required: true,
    description:
      lang === 'en'
        ? `Field type DSL. Remove this parameter and '${f.name}' leaves the response.`
        : `필드 타입 DSL. 이 파라미터를 빼면 응답에서 '${f.name}' 이 사라진다.`,
    schema: { type: 'string', default: f.typeRaw },
  }));
}

export function generateOpenApi(
  q: ParsedQuery,
  resource: string,
  origin: string,
  lang: 'ko' | 'en' = 'ko',
): Record<string, unknown> {
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko);
  const name = interfaceName(resource);
  const ref = `#/components/schemas/${name}`;

  // /schema/ts 와 같은 규칙 — 쓰기 메서드는 단건 응답이라 _wrap=one 과 같은 모양이다
  const method = q.method ?? 'GET';
  const wrap = method !== 'GET' ? 'one' : q.wrap;

  const status = q.statusSet ? q.status : method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  const body =
    wrap === 'one' ? { $ref: ref } : wrap === 'none' ? { type: 'array', items: { $ref: ref } } : envelopeSchema(ref);

  const responses: Record<string, unknown> = {
    [String(status)]:
      method === 'DELETE' && !q.statusSet
        ? { description: t('삭제됨 — 본문 없음', 'Deleted — no content') }
        : {
            description: t('목 데이터', 'Mock data'),
            content: { 'application/json': { schema: body } },
          },
    '400': {
      description: t('DSL 오류 — 무엇이 왜 틀렸는지 hint 로 알려준다', 'DSL error — hint explains what is wrong and how to fix it'),
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              field: { type: 'string' },
              value: { type: 'string' },
              hint: { type: 'string' },
            },
            required: ['error', 'hint'],
          },
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: `${name} — mocappi`,
      version: '1.0.0',
      description: t(
        '쿼리스트링이 곧 스키마인 목 REST API. 같은 URL 은 언제나 같은 바이트를 돌려준다.\n' +
          '아래 필드 파라미터의 기본값이 이 문서를 만든 URL 그대로다 — 지우면 그 필드가 응답에서 빠진다.\n' +
          '_format=ndjson|csv 를 주면 application/json 대신 아이템만 스트리밍된다.',
        'A mock REST API whose schema is the query string. The same URL always returns the same bytes.\n' +
          'The field parameter defaults below reproduce the exact URL this document came from — remove one and that field leaves the response.\n' +
          'With _format=ndjson|csv the response streams items instead of application/json.',
      ),
    },
    servers: [{ url: origin }],
    paths: {
      [`/api/${resource}`]: {
        [method.toLowerCase()]: {
          summary: t(`${name} 목 데이터`, `Mock ${name} data`),
          operationId: method.toLowerCase() + name,
          parameters: [...fieldParams(q.fields, lang), ...reservedParams(lang)],
          responses,
        },
      },
    },
    components: { schemas: { [name]: emitNode(buildTree(q.fields), q.locale) } },
  };
}
