/**
 * 타입 레지스트리 — DSL 타입 문자열 → 생성 함수 컴파일.
 * 각 생성 함수는 (seed, ctx) => value 시그니처의 순수 함수다.
 */
import { faker as fakerKO } from '@faker-js/faker/locale/ko';
import { faker as fakerEN } from '@faker-js/faker/locale/en';
import type { Faker } from '@faker-js/faker';
import { createRNG } from './rng';

export type Locale = 'ko' | 'en';

const FAKERS: Record<Locale, Faker> = { ko: fakerKO, en: fakerEN };

// faker의 date.* 계열은 기본 refDate가 "지금"이라 결정론이 깨진다. 고정한다.
const REF_DATE = new Date('2026-01-01T00:00:00.000Z');
fakerKO.setDefaultRefDate(REF_DATE);
fakerEN.setDefaultRefDate(REF_DATE);

export interface GenContext {
  globalIndex: number;
  locale: Locale;
}

export type Generator = (seed: number, ctx: GenContext) => unknown;

export interface DslErrorInfo {
  error: string;
  field?: string;
  value?: string;
  hint: string;
}

/** 파싱/생성 실패 시 던지는 에러. 워커가 400 + info 로 응답한다. */
export class DslError extends Error {
  constructor(public info: DslErrorInfo) {
    super(info.error);
    this.name = 'DslError';
  }
}

const KNOWN_TYPES = 'int, float, bool, enum, const, text, image, date, uuid, index, pattern';

/** nullable 수식자 — 아무 타입 뒤 '?확률'. 예: internet.email?0.2 */
export const NULLABLE_RE = /^(.+)\?(0?\.\d+|1|0)$/;
const RANGE_HINT = (t: string, ex: string) => `범위 구분자는 '~' 입니다. 예: ${t}:${ex}`;

function fail(error: string, value: string, hint: string): never {
  throw new DslError({ error, value, hint });
}

function parseIntStrict(s: string): number | null {
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
}

function parseNumStrict(s: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
}

function uuidFromSeed(seed: number): string {
  const rng = createRNG(seed);
  const b: number[] = [];
  for (let i = 0; i < 16; i++) b.push(Math.floor(rng.next() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// faker 경로 (person.fullName 등)
// ---------------------------------------------------------------------------

/** 위험하거나 데이터 생성용이 아닌 모듈/메서드 차단 */
const DENY_MODULES = new Set([
  'helpers', 'definitions', 'rawDefinitions', 'seed', 'fork', 'derive',
  'setDefaultRefDate', 'getMetadata', 'constructor',
]);

function compileFakerPath(raw: string): Generator {
  const segs = raw.split('.');
  if (segs.length !== 2 || !segs[0] || !segs[1]) {
    fail('Invalid faker path', raw, "faker 경로는 '모듈.메서드' 2단계입니다. 예: person.fullName");
  }
  const [mod, method] = segs;
  const notFound = () =>
    fail('Unknown faker path', raw, `'${raw}' 를 찾을 수 없습니다. GET /schema/types 에서 지원 목록을 확인하세요.`);
  if (mod.startsWith('_') || method.startsWith('_') || DENY_MODULES.has(mod)) notFound();
  const m = (fakerEN as unknown as Record<string, unknown>)[mod];
  if (!m || typeof m !== 'object' || typeof (m as Record<string, unknown>)[method] !== 'function') notFound();
  return (seed, ctx) => {
    const f = FAKERS[ctx.locale];
    f.seed(seed);
    const v = (f as unknown as Record<string, Record<string, () => unknown>>)[mod][method]();
    return v instanceof Date ? v.toISOString() : v;
  };
}

// ---------------------------------------------------------------------------
// DSL 스칼라 타입
// ---------------------------------------------------------------------------

function compileInt(rest: string, raw: string): Generator {
  const m = rest.match(/^(-?\d+)~(-?\d+)$/);
  if (!m) fail('Invalid int range', raw, RANGE_HINT('int', '20~60'));
  const min = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (min > max) fail('Invalid int range', raw, `최솟값(${min})이 최댓값(${max})보다 큽니다.`);
  return (seed) => createRNG(seed).int(min, max);
}

function compileFloat(rest: string, raw: string): Generator {
  const parts = rest.split(':');
  if (parts.length > 2) fail('Invalid float spec', raw, '형식: float:min~max 또는 float:min~max:자릿수. 예: float:0~100:2');
  const m = parts[0].match(/^(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)$/);
  if (!m) fail('Invalid float range', raw, RANGE_HINT('float', '0~100:2'));
  const min = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  if (min > max) fail('Invalid float range', raw, `최솟값(${min})이 최댓값(${max})보다 큽니다.`);
  let decimals = 2;
  if (parts.length === 2) {
    const d = parseIntStrict(parts[1]);
    if (d === null || d < 0 || d > 10) fail('Invalid float decimals', raw, '소수점 자릿수는 0~10 사이 정수입니다. 예: float:0~100:2');
    decimals = d;
  }
  return (seed) => parseFloat(createRNG(seed).float(min, max).toFixed(decimals));
}

function compileBool(rest: string, raw: string): Generator {
  let prob = 0.5;
  if (rest !== '') {
    const p = parseNumStrict(rest);
    if (p === null || p < 0 || p > 1) fail('Invalid bool probability', raw, 'true 확률은 0~1 사이 숫자입니다. 예: bool:0.8');
    prob = p;
  }
  return (seed) => createRNG(seed).next() < prob;
}

function compileEnum(rest: string, raw: string): Generator {
  const members = rest.split('|');
  if (rest === '' || members.some((v) => v === '')) {
    fail('Invalid enum values', raw, "'|' 로 구분한 값 목록이 필요합니다. 예: enum:admin|user|guest (가중치: enum:paid*8|refund*2)");
  }
  // 가중치 파싱 — 멤버 끝의 '*숫자'. 하나도 없으면 기존 균등 선택 경로(기존 URL 결정성 유지)
  let weighted = false;
  const values: string[] = [];
  const weights: number[] = [];
  for (const m of members) {
    const wm = m.match(/^(.+)\*(\d+(?:\.\d+)?)$/);
    if (wm) {
      const w = parseFloat(wm[2]);
      if (w <= 0) fail('Invalid enum weight', raw, `가중치는 0보다 커야 합니다: '${m}'. 예: enum:paid*8|refund*2`);
      values.push(wm[1]);
      weights.push(w);
      weighted = true;
    } else {
      values.push(m);
      weights.push(1);
    }
  }
  if (!weighted) return (seed) => createRNG(seed).pick(values);
  const total = weights.reduce((a, b) => a + b, 0);
  return (seed) => {
    let u = createRNG(seed).next() * total;
    for (let i = 0; i < values.length; i++) {
      u -= weights[i];
      if (u < 0) return values[i];
    }
    return values[values.length - 1];
  };
}

function compilePattern(rest: string, raw: string): Generator {
  if (rest === '') fail('Invalid pattern', raw, '템플릿이 필요합니다. #=숫자, ?=대문자, *=영숫자, 나머지는 그대로. 예: pattern:ORD-####-???');
  if (rest.length > 64) fail('Invalid pattern', raw, '템플릿은 최대 64자입니다.');
  const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const AN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return (seed) => {
    const rng = createRNG(seed);
    let out = '';
    for (const ch of rest) {
      if (ch === '#') out += rng.int(0, 9);
      else if (ch === '?') out += UP[rng.int(0, 25)];
      else if (ch === '*') out += AN[rng.int(0, 35)];
      else out += ch;
    }
    return out;
  };
}

function compileText(rest: string, raw: string): Generator {
  const len = parseIntStrict(rest);
  if (len === null || len < 1 || len > 10000) fail('Invalid text length', raw, '길이는 1~10000 사이 정수입니다. 예: text:50');
  return (seed, ctx) => {
    const f = FAKERS[ctx.locale];
    f.seed(seed);
    let s = f.lorem.sentence();
    while (s.length < len) s += ' ' + f.lorem.sentence();
    return s.slice(0, len);
  };
}

function compileImage(rest: string, raw: string): Generator {
  const m = rest.match(/^(\d+)x(\d+)$/);
  if (!m) fail('Invalid image size', raw, '형식: image:너비x높이. 예: image:200x200');
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (w < 1 || h < 1 || w > 4000 || h > 4000) fail('Invalid image size', raw, '크기는 1~4000 사이입니다.');
  return (seed) => `https://picsum.photos/seed/${seed.toString(36)}/${w}/${h}`;
}

function compileDate(rest: string, raw: string): Generator {
  const m = rest.match(/^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/);
  if (!m) fail('Invalid date range', raw, "형식: date:YYYY-MM-DD~YYYY-MM-DD. 범위 구분자는 '~' 입니다. 예: date:2020-01-01~2024-12-31");
  const from = Date.parse(m[1] + 'T00:00:00.000Z');
  const to = Date.parse(m[2] + 'T23:59:59.999Z');
  if (Number.isNaN(from) || Number.isNaN(to)) fail('Invalid date', raw, '유효한 날짜가 아닙니다. 예: date:2020-01-01~2024-12-31');
  if (from > to) fail('Invalid date range', raw, '시작일이 종료일보다 늦습니다.');
  return (seed) => new Date(createRNG(seed).int(from, to)).toISOString();
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/** DSL 타입 문자열 → 생성 함수. 실패 시 DslError. */
export function compileType(raw: string): Generator {
  // nullable 수식자 — 모든 타입에 적용 가능. null 판정은 값 생성과 다른 시드
  // 스트림을 사용한다 (같은 시드를 쓰면 bool:0.5?0.5 처럼 값과 상관이 생긴다).
  const nm = raw.match(NULLABLE_RE);
  if (nm) {
    const p = parseFloat(nm[2]);
    const inner = compileType(nm[1]);
    return (seed, ctx) => (createRNG((seed ^ 0x6e756c6c) >>> 0).next() < p ? null : inner(seed, ctx));
  }

  const ci = raw.indexOf(':');
  const head = ci === -1 ? raw : raw.slice(0, ci);
  const rest = ci === -1 ? '' : raw.slice(ci + 1);

  switch (head) {
    case 'uuid':
      if (rest !== '') fail('Invalid uuid spec', raw, "uuid 는 인자를 받지 않습니다. 'uuid' 로만 쓰세요.");
      return (seed) => uuidFromSeed(seed);
    case 'index':
      if (rest !== '') fail('Invalid index spec', raw, "index 는 인자를 받지 않습니다. 'index' 로만 쓰세요.");
      return (_seed, ctx) => ctx.globalIndex;
    case 'int': {
      // 계획서의 대표 에러 케이스: int:20-60 → '~' 힌트
      return compileInt(rest, raw);
    }
    case 'float':
      return compileFloat(rest, raw);
    case 'bool':
      return compileBool(rest, raw);
    case 'enum':
      return compileEnum(rest, raw);
    case 'const':
      return () => rest;
    case 'text':
      return compileText(rest, raw);
    case 'image':
      return compileImage(rest, raw);
    case 'date':
      return compileDate(rest, raw);
    case 'pattern':
      return compilePattern(rest, raw);
    default:
      if (raw.includes('.')) return compileFakerPath(raw);
      fail(
        'Unknown field type',
        raw,
        `지원 타입: ${KNOWN_TYPES}. faker 경로는 'person.fullName' 처럼 '모듈.메서드' 형태입니다. 전체 목록: GET /schema/types`,
      );
  }
}

// ---------------------------------------------------------------------------
// /schema/types 응답 — 서버 레지스트리와 GUI의 단일 소스
// ---------------------------------------------------------------------------

export const TYPE_DOCS = {
  reserved: [
    { name: '_page', default: '1', desc: '페이지 번호 (1-base)' },
    { name: '_limit', default: '10', desc: '페이지당 항목 수 (최대 100)' },
    { name: '_total', default: '100', desc: '전체 항목 수 (가상)' },
    { name: '_seed', default: 'URL 해시', desc: '명시하면 고정 시드 사용' },
    { name: '_locale', default: 'ko', desc: 'ko | en' },
    { name: '_delay', default: '0', desc: '응답 지연 ms (최대 5000)' },
    { name: '_status', default: '200', desc: '강제 HTTP 상태코드' },
    { name: '_wrap', default: 'envelope', desc: 'envelope | none(배열만)' },
    { name: '_s', default: '—', desc: '저장된 팀 스키마 ID. 다른 파라미터로 오버라이드 가능 (예: ?_s=aB3xK9&_page=2)' },
  ],
  dslTypes: [
    { type: 'int', syntax: 'int:min~max', example: 'int:20~60', label: '정수 범위' },
    { type: 'float', syntax: 'float:min~max[:자릿수]', example: 'float:0~100:2', label: '실수 범위' },
    { type: 'bool', syntax: 'bool[:true확률]', example: 'bool:0.8', label: '불리언' },
    { type: 'enum', syntax: 'enum:a|b|c', example: 'enum:admin|user|guest', label: '열거형 중 택1' },
    { type: 'const', syntax: 'const:값', example: 'const:user', label: '고정 리터럴' },
    { type: 'text', syntax: 'text:길이', example: 'text:50', label: '지정 길이 문자열' },
    { type: 'image', syntax: 'image:WxH', example: 'image:200x200', label: '이미지 URL' },
    { type: 'date', syntax: 'date:시작~끝', example: 'date:2020-01-01~2024-12-31', label: '날짜 (ISO)' },
    { type: 'uuid', syntax: 'uuid', example: 'uuid', label: 'UUID v4' },
    { type: 'index', syntax: 'index', example: 'index', label: '전역 인덱스 (0,1,2…)' },
    { type: 'pattern', syntax: 'pattern:템플릿 (#=숫자 ?=대문자 *=영숫자)', example: 'pattern:ORD-####-???', label: '패턴 문자열' },
    { type: 'enum', syntax: 'enum:a*가중치|b*가중치', example: 'enum:paid*8|refund*2', label: '가중치 enum' },
    { type: 'nullable', syntax: '아무타입?확률', example: 'internet.email?0.2', label: 'null 섞기 (수식자)' },
  ],
  fakerPaths: [
    { value: 'person.fullName', label: '이름(전체)' },
    { value: 'person.firstName', label: '이름' },
    { value: 'person.lastName', label: '성' },
    { value: 'person.jobTitle', label: '직함' },
    { value: 'internet.email', label: '이메일' },
    { value: 'internet.url', label: 'URL' },
    { value: 'internet.ip', label: 'IP 주소' },
    { value: 'phone.number', label: '전화번호' },
    { value: 'location.city', label: '도시' },
    { value: 'location.streetAddress', label: '도로명 주소' },
    { value: 'location.zipCode', label: '우편번호' },
    { value: 'location.country', label: '국가' },
    { value: 'company.name', label: '회사명' },
    { value: 'commerce.productName', label: '상품명' },
    { value: 'commerce.department', label: '상품 카테고리' },
    { value: 'lorem.word', label: '단어' },
    { value: 'lorem.sentence', label: '문장' },
    { value: 'lorem.paragraph', label: '문단' },
    { value: 'string.alphanumeric', label: '영숫자 문자열' },
    { value: 'color.rgb', label: '색상 (rgb)' },
  ],
  arrays: { syntax: '이름[]=타입:개수', example: 'tags[]=lorem.word:3', desc: "배열 필드. 값의 마지막 ':정수' 가 배열 길이 (기본 3, 최대 100)" },
  nested: { syntax: 'a.b=타입', example: 'address.city=location.city', desc: '점 표기법 → 중첩 객체' },
} as const;
