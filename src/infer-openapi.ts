/**
 * OpenAPI 문서 → 스키마 추론.
 * /schema/infer 에 붙여넣은 것이 예시 JSON 이 아니라 OpenAPI 문서(3.x·Swagger 2.0)면
 * 응답 스키마 선언을 읽어 DSL 로 변환한다 — infer.ts 가 "값"을 보고 추측한다면
 * 여기는 "선언"을 읽는다. 팀에 이미 있는 스펙 문서가 그대로 목 API 가 되는 경로.
 *
 * /schema/openapi(내보내기)의 역방향이지만 왕복 보장은 목표가 아니다 — 임의의
 * 문서를 받아 "합리적인 목"을 만드는 게 목적이라, 표현 못 하는 조합은 조용히
 * 버리지 않고 skipped 로 알려준다 (infer.ts 와 같은 계약).
 */
import { DslError, compileType } from './registry';
import { ENUM_SAFE_RE, FIELD_KEY_RE, dslForKeyOnly, inferScalar, type InferResult } from './infer';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const MAX_DEPTH = 5; // dsl.ts 의 중첩 상한과 같은 값
const MAX_FIELDS = 100;

/** 버전 문자열(openapi/swagger) + paths 객체 — 둘 다 있어야 문서로 본다 */
export function isOpenApiDoc(v: unknown): boolean {
  if (!isObj(v)) return false;
  const ver = v.openapi ?? v.swagger;
  return typeof ver === 'string' && isObj(v.paths);
}

// ---------------------------------------------------------------------------
// $ref 해석 + allOf/oneOf/anyOf 정리
// ---------------------------------------------------------------------------

/** JSON 포인터 한 조각 unescape — RFC 6901 (~1 → '/', ~0 → '~') */
const unescapePtr = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');

function refTarget(ref: string, doc: Obj): Obj | null {
  if (!ref.startsWith('#/')) return null; // 외부 파일 참조는 지원하지 않는다
  let cur: unknown = doc;
  for (const seg of ref.slice(2).split('/')) {
    if (!isObj(cur)) return null;
    cur = cur[unescapePtr(seg)];
  }
  return isObj(cur) ? cur : null;
}

interface Resolved {
  s: Obj;
  nullable: boolean;
}

/**
 * 스키마 노드 하나를 "바로 읽을 수 있는" 형태로: $ref 해석, allOf 병합,
 * oneOf/anyOf 는 첫 비-null 갈래 선택, nullable(3.0 nullable / 3.1 type 배열 /
 * oneOf 의 null 갈래)을 플래그로 분리. 순환 참조는 null — 호출부가 skipped 처리.
 */
function resolve(node: unknown, doc: Obj, seen: ReadonlySet<string>): Resolved | null {
  if (!isObj(node)) return null;

  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return null; // 순환 — 무한 재귀 차단
    const target = refTarget(node.$ref, doc);
    if (!target) return null;
    return resolve(target, doc, new Set(seen).add(node.$ref));
  }

  let s: Obj = node;
  let nullable = s.nullable === true || s['x-nullable'] === true;

  // 3.1: type 이 배열이면 'null' 을 nullable 로 분리하고 나머지 하나를 취한다
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== 'null');
    nullable = nullable || types.length !== s.type.length;
    s = { ...s, type: types[0] };
  }

  // allOf — 객체 조합 패턴. properties/required 를 얕게 병합한다
  if (Array.isArray(s.allOf)) {
    const merged: Obj = { ...s, type: s.type ?? 'object' };
    const props: Obj = isObj(s.properties) ? { ...s.properties } : {};
    const req: unknown[] = Array.isArray(s.required) ? [...s.required] : [];
    for (const part of s.allOf) {
      const r = resolve(part, doc, seen);
      if (!r) continue;
      nullable = nullable || r.nullable;
      if (isObj(r.s.properties)) Object.assign(props, r.s.properties);
      if (Array.isArray(r.s.required)) req.push(...r.s.required);
    }
    delete merged.allOf;
    merged.properties = props;
    merged.required = req;
    return { s: merged, nullable };
  }

  // oneOf/anyOf — 첫 비-null 갈래를 취한다 (null 갈래는 nullable 로)
  const variants = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
  if (variants) {
    let picked: Resolved | null = null;
    for (const part of variants) {
      const r = resolve(part, doc, seen);
      if (!r) continue;
      if (r.s.type === 'null') {
        nullable = true;
        continue;
      }
      if (!picked) picked = r;
    }
    if (picked) return { s: picked.s, nullable: nullable || picked.nullable };
  }

  return { s, nullable };
}

// ---------------------------------------------------------------------------
// 스키마 노드 → DSL 타입 문자열
// ---------------------------------------------------------------------------

/**
 * 프로퍼티 노드가 가리키는 직접 $ref 사슬을 chain 에 더한 새 집합 — 순환이면 null.
 * resolve 는 자기 내부 재귀만 지키므로, "객체 → 프로퍼티 → 조상 스키마 재참조"의
 * 순환은 walk 가 이 사슬을 이어 줘야 잡힌다 (안 잡으면 깊이 제한까지 헛돈다).
 */
function extendChain(node: unknown, doc: Obj, chain: ReadonlySet<string>): Set<string> | null {
  const next = new Set(chain);
  let cur: unknown = node;
  while (isObj(cur) && typeof cur.$ref === 'string') {
    if (next.has(cur.$ref)) return null;
    next.add(cur.$ref);
    cur = refTarget(cur.$ref, doc);
    if (cur === null) break;
  }
  return next;
}

const clampInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;

/** string format → DSL. 날짜는 export(openapi.ts)의 refDate 와 무관 — 문서엔 값이 없다 */
const FORMAT_DSL: Record<string, string> = {
  uuid: 'uuid',
  email: 'internet.email',
  'idn-email': 'internet.email',
  'date-time': 'date:2024-01-01~2026-12-31',
  date: 'date:2024-01-01~2026-12-31',
  uri: 'internet.url',
  url: 'internet.url',
  'uri-reference': 'internet.url',
  hostname: 'internet.url',
  ipv4: 'internet.ip',
  ipv6: 'internet.ip',
};

function dslOfScalar(keyLc: string, s: Obj): string | null {
  // enum — 값이 DSL 구분자와 충돌하지 않을 때만 (infer.ts 의 tryEnum 과 같은 안전 규칙)
  if (Array.isArray(s.enum)) {
    const vals = s.enum.filter((v) => v !== null);
    if (
      vals.length >= 1 &&
      vals.every((v) => (typeof v === 'string' || typeof v === 'number') && ENUM_SAFE_RE.test(String(v)))
    ) {
      return `enum:${vals.map(String).join('|')}`;
    }
  }
  if (typeof s.const === 'string' || typeof s.const === 'number' || typeof s.const === 'boolean') {
    return `const:${String(s.const)}`;
  }

  const type = typeof s.type === 'string' ? s.type : null;

  if (type === 'string' && typeof s.format === 'string' && FORMAT_DSL[s.format]) {
    return FORMAT_DSL[s.format];
  }

  // 예시 값이 있으면 값 기반 추론이 선언보다 구체적이다 (실제 날짜 범위, 마스킹 감지 등)
  const example = s.example ?? (Array.isArray(s.examples) ? s.examples[0] : undefined) ?? s.default;
  if (example !== undefined && example !== null && typeof example !== 'object') {
    if (
      (type === 'string' && typeof example === 'string') ||
      (type === 'integer' && typeof example === 'number') ||
      (type === 'number' && typeof example === 'number') ||
      (type === 'boolean' && typeof example === 'boolean') ||
      type === null
    ) {
      return inferScalar(keyLc, example);
    }
  }

  switch (type) {
    case 'string': {
      const keyed = dslForKeyOnly(keyLc);
      if (keyed) return keyed;
      const maxLen = clampInt(s.maxLength, 0);
      if (maxLen >= 5) return `text:${Math.min(maxLen, 500)}`;
      return 'lorem.word';
    }
    case 'integer': {
      if (keyLc === 'id' || keyLc.endsWith('index') || keyLc === 'seq' || keyLc === 'sequence' || keyLc === 'no') return 'index';
      if (keyLc === 'age') return 'int:18~65';
      const min = clampInt(s.minimum, 0);
      const max = clampInt(s.maximum, Math.max(min, 0) + 100);
      return max >= min ? `int:${min}~${max}` : `int:${max}~${min}`;
    }
    case 'number': {
      const min = clampInt(s.minimum, 0);
      const max = clampInt(s.maximum, Math.max(min, 0) + 100);
      return max >= min ? `float:${min}~${max}:2` : `float:${max}~${min}:2`;
    }
    case 'boolean':
      return 'bool';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 오퍼레이션 선택 — 문서에서 "목으로 만들 가장 그럴듯한" 응답 하나
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const JSON_CT_RE = /^application\/([\w.-]+\+)?json/i;
const WRAP_KEYS = new Set([
  'data', 'items', 'results', 'result', 'list', 'rows', 'records', 'content', 'payload', 'response', 'body',
]);

interface Candidate {
  path: string;
  method: string;
  schema: Obj;
  score: number;
}

/** 응답 객체에서 JSON 스키마 노드 — 3.x 는 content[application/json].schema, 2.0 은 schema */
function jsonSchemaOfResponse(resp: unknown, doc: Obj): Obj | null {
  const r = resolve(resp, doc, new Set());
  if (!r) return null;
  if (isObj(r.s.content)) {
    for (const [ct, media] of Object.entries(r.s.content)) {
      if ((JSON_CT_RE.test(ct) || ct === '*/*') && isObj(media) && isObj(media.schema)) return media.schema;
    }
    return null;
  }
  return isObj(r.s.schema) ? r.s.schema : null; // swagger 2.0
}

function findCandidates(doc: Obj): Candidate[] {
  const out: Candidate[] = [];
  const paths = doc.paths as Obj;
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObj(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isObj(op) || !isObj(op.responses)) continue;
      // 성공 응답 우선순위: 200 → 201 → 나머지 2xx → default
      const codes = Object.keys(op.responses).sort((a, b) => rank(a) - rank(b));
      for (const code of codes) {
        if (rank(code) === 99) continue;
        const schema = jsonSchemaOfResponse(op.responses[code], doc);
        if (!schema) continue;
        const r = resolve(schema, doc, new Set());
        const listish = !!r && (r.s.type === 'array' || envelopeItems(r.s, doc) !== null);
        out.push({
          path,
          method,
          schema,
          score: (method === 'get' ? 10 : 0) + (code === '200' ? 4 : 2) + (listish ? 5 : 0) - path.split('/').length,
        });
        break; // 오퍼레이션당 최선의 응답 하나
      }
    }
  }
  return out;
}

const rank = (code: string): number =>
  code === '200' ? 0 : code === '201' ? 1 : /^2\d\d$/.test(code) ? 2 : code === 'default' ? 3 : 99;

/** envelope 스키마({data: [...]} 등)면 항목 스키마를, 아니면 null */
function envelopeItems(s: Obj, doc: Obj): Obj | null {
  if (s.type !== 'object' && s.type !== undefined) return null;
  if (!isObj(s.properties)) return null;
  for (const [k, v] of Object.entries(s.properties)) {
    if (!WRAP_KEYS.has(k.toLowerCase())) continue;
    const r = resolve(v, doc, new Set());
    if (r && r.s.type === 'array' && isObj(r.s.items)) return r.s.items;
  }
  return null;
}

/** 경로에서 리소스 이름 — 뒤에서부터 {param} 이 아닌 첫 세그먼트 */
function resourceOf(path: string): string | undefined {
  const segs = path.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!segs[i].startsWith('{') && /^[A-Za-z][A-Za-z0-9_-]*$/.test(segs[i])) return segs[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

export function inferFromOpenApi(doc: unknown, lang: 'ko' | 'en' = 'ko'): InferResult & { res?: string } {
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko);
  const d = doc as Obj;

  const candidates = findCandidates(d);
  if (candidates.length === 0) {
    throw new DslError({
      error: 'No importable operation',
      hint: 'OpenAPI 문서에서 JSON 응답 스키마를 찾지 못했습니다. paths 아래 responses 에 application/json 스키마가 있어야 합니다.',
      hintEn: 'No JSON response schema found in the OpenAPI document. An operation needs an application/json schema under paths → responses.',
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // 목록 응답이면 항목으로 내려간다 — 배열 자체 / envelope 안의 배열
  let chain: ReadonlySet<string> = extendChain(best.schema, d, new Set()) ?? new Set<string>();
  const root = resolve(best.schema, d, new Set());
  let item: Resolved | null = root;
  if (root && root.s.type === 'array') {
    item = resolve(root.s.items, d, new Set());
    chain = extendChain(root.s.items, d, chain) ?? chain;
  } else if (root) {
    const env = envelopeItems(root.s, d);
    if (env) {
      item = resolve(env, d, new Set());
      chain = extendChain(env, d, chain) ?? chain;
    }
  }
  if (!item || (!isObj(item.s.properties) && item.s.type !== 'object')) {
    throw new DslError({
      error: 'Cannot infer schema',
      hint: `'${best.method.toUpperCase()} ${best.path}' 응답이 객체 스키마가 아닙니다. properties 를 가진 object(또는 그 배열)여야 합니다.`,
      hintEn: `The response of '${best.method.toUpperCase()} ${best.path}' is not an object schema. It must be an object with properties (or an array of one).`,
    });
  }

  const fields: InferResult['fields'] = [];
  const skipped: InferResult['skipped'] = [];

  function push(name: string, type: string, path: string): void {
    const itemType = name.endsWith('[]') ? type.replace(/:\d+$/, '') : type;
    try {
      compileType(itemType);
      fields.push({ name, type });
    } catch {
      const fallback = name.endsWith('[]') ? 'lorem.word:3' : 'text:20';
      fields.push({ name, type: fallback });
      skipped.push({ path, reason: t(`'${type}' 변환 실패 — '${fallback}' 로 대체`, `Could not convert '${type}' — replaced with '${fallback}'`) });
    }
  }

  function walk(props: Obj, prefix: string, depth: number, chain: ReadonlySet<string>): void {
    for (const [k, v] of Object.entries(props)) {
      if (fields.length >= MAX_FIELDS) return;
      const path = prefix ? `${prefix}.${k}` : k;
      if (!FIELD_KEY_RE.test(k)) {
        skipped.push({ path, reason: t('필드명 규칙(영문 시작, 영숫자/_)에 맞지 않음', 'Does not fit the field name rule (letter first, alphanumerics/_)') });
        continue;
      }
      const chain2 = extendChain(v, d, chain);
      if (!chain2) {
        skipped.push({ path, reason: t('순환 참조 — 자기 자신을 포함하는 스키마', 'Circular reference — the schema contains itself') });
        continue;
      }
      const r = resolve(v, d, chain);
      if (!r) {
        skipped.push({ path, reason: t('$ref 를 해석할 수 없음 (순환 또는 외부 참조)', 'Unresolvable $ref (circular or external)') });
        continue;
      }
      const s = r.s;
      // required 에 없는 필드도 목은 항상 채운다 — nullable 선언만 ?확률로 반영
      const suffix = r.nullable ? '?0.2' : '';

      if (s.type === 'object' || (s.type === undefined && isObj(s.properties))) {
        if (!isObj(s.properties) || Object.keys(s.properties).length === 0) {
          skipped.push({ path, reason: t('properties 없는 object — 필드를 알 수 없음', 'object without properties — fields unknown') });
        } else if (depth >= MAX_DEPTH) {
          skipped.push({ path, reason: t(`중첩 ${MAX_DEPTH}단계 초과`, `Nesting deeper than ${MAX_DEPTH} levels`) });
        } else {
          walk(s.properties, path, depth + 1, chain2);
        }
        continue;
      }
      if (s.type === 'array') {
        const ir = resolve(s.items, d, chain2);
        if (!ir) {
          skipped.push({ path, reason: t('items 없는 배열 — 요소 타입을 알 수 없음', 'array without items — element type unknown') });
          continue;
        }
        if (ir.s.type === 'object' || isObj(ir.s.properties)) {
          skipped.push({ path, reason: t('객체 배열은 v1 DSL 미지원', 'Arrays of objects are not supported by the v1 DSL') });
          continue;
        }
        const itemDsl = dslOfScalar(k.toLowerCase(), ir.s);
        if (!itemDsl) {
          skipped.push({ path, reason: t('배열 요소 타입을 알 수 없음', 'Unknown array element type') });
          continue;
        }
        const len = clampInt(s.minItems, 0) === clampInt(s.maxItems, -1) ? Math.min(Math.max(clampInt(s.minItems, 3), 1), 100) : 3;
        push(`${path}[]`, `${itemDsl}${suffix}:${len}`, path);
        continue;
      }

      const dsl = dslOfScalar(k.toLowerCase(), s);
      if (!dsl) {
        skipped.push({ path, reason: t('타입 선언이 없음', 'No type declaration') });
        continue;
      }
      push(path, dsl + suffix, path);
    }
  }

  walk(isObj(item.s.properties) ? item.s.properties : {}, '', 1, chain);

  if (fields.length === 0) {
    throw new DslError({
      error: 'No inferable fields',
      hint: `'${best.method.toUpperCase()} ${best.path}' 응답에서 변환 가능한 필드가 없습니다.`,
      hintEn: `No convertible fields in the response of '${best.method.toUpperCase()} ${best.path}'.`,
    });
  }

  const others = candidates.length - 1;
  const note =
    t(
      `OpenAPI 문서의 '${best.method.toUpperCase()} ${best.path}' 응답 스키마를 가져왔습니다.`,
      `Imported the response schema of '${best.method.toUpperCase()} ${best.path}' from the OpenAPI document.`,
    ) +
    (others > 0
      ? ' ' + t(
          `다른 오퍼레이션 ${others}개는 무시했습니다 — 원하는 경로만 남긴 문서를 붙여넣으면 그 경로를 가져옵니다.`,
          `${others} other operation${others === 1 ? ' was' : 's were'} ignored — paste a document with just the path you want to import that one.`,
        )
      : '');

  const res = resourceOf(best.path);
  return res ? { fields, skipped, note, res } : { fields, skipped, note };
}
