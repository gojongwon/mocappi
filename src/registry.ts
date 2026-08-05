/**
 * 타입 레지스트리 — DSL 타입 문자열 → 생성 함수 컴파일.
 * 각 생성 함수는 (seed, ctx) => value 시그니처의 순수 함수다.
 */
import { Faker, ko, en, ja, zh_CN, base, type Randomizer } from '@faker-js/faker';
import { createRNG, hashString } from './rng';

export type Locale = 'ko' | 'en' | 'ja' | 'zh';

/**
 * mulberry32 기반 커스텀 randomizer.
 * faker 기본 RNG(Mersenne Twister)는 seed 리셋이 ~17µs 로, 필드마다 시드를
 * 리셋하는 우리 설계에서 생성 비용의 88% 를 차지했다. mulberry32 는 상태가
 * 변수 하나라 리셋이 공짜 — faker 필드 생성이 10배 빨라진다 (대용량 _limit 의 전제).
 */
function mulberryRandomizer(): Randomizer {
  let s = 0;
  return {
    next(): number {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    seed(v: number | number[]): void {
      s = (Array.isArray(v) ? v[0] : v) | 0;
    },
  };
}

const FAKERS: Record<Locale, Faker> = {
  ko: new Faker({ locale: [ko, en, base], randomizer: mulberryRandomizer() }),
  en: new Faker({ locale: [en, base], randomizer: mulberryRandomizer() }),
  ja: new Faker({ locale: [ja, en, base], randomizer: mulberryRandomizer() }),
  zh: new Faker({ locale: [zh_CN, en, base], randomizer: mulberryRandomizer() }),
};

// faker의 date.* 계열은 기본 refDate가 "지금"이라 결정론이 깨진다. 고정한다.
const REF_DATE = new Date('2026-01-01T00:00:00.000Z');
for (const f of Object.values(FAKERS)) f.setDefaultRefDate(REF_DATE);

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
  /** 영어 힌트 (Accept-Language: en 응답용) — 직렬화 시 hint 자리에 대신 들어간다 */
  hintEn?: string;
}

/** 파싱/생성 실패 시 던지는 에러. 워커가 400 + info 로 응답한다. */
export class DslError extends Error {
  constructor(public info: DslErrorInfo) {
    super(info.error);
    this.name = 'DslError';
  }
}

const KNOWN_TYPES = 'int, float, bool, enum, const, text, image, date, uuid, index, pattern, pk, ref';

/** nullable 수식자 — 아무 타입 뒤 '?확률'. 예: internet.email?0.2 */
export const NULLABLE_RE = /^(.+)\?(0?\.\d+|1|0)$/;
const RANGE_HINT = (t: string, ex: string) => `범위 구분자는 '~' 입니다. 예: ${t}:${ex}`;
const RANGE_HINT_EN = (t: string, ex: string) => `Use '~' as the range separator, e.g. ${t}:${ex}`;

function fail(error: string, value: string, hint: string, hintEn?: string): never {
  throw new DslError({ error, value, hint, hintEn });
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

// 연락처 안전 오버라이드 — "형식은 유효, 실존은 불가능"
// email: @example.com 은 RFC 2606 예약 도메인이라 절대 배달되지 않음이 보장된다.
//        (faker 기본값은 실제 gmail.com 등을 써서 우연히 실존할 수 있고, ko 유저명은 깨진다)
// phone: ko 010-, ja 090-, zh 1[3-9]+9자리 유효 형식. en 은 픽션 예약 대역 555-01##.
const emailGen: Generator = (seed) => {
  const f = FAKERS.en; // 이메일 유저명은 ASCII — 로케일 무관
  f.seed(seed);
  const first = f.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
  const last = f.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = f.number.int({ min: 0, max: 99 });
  const forms = [`${first}.${last}`, `${first}${last}${n}`, `${first}_${last}`, `${first}${n}`];
  return `${forms[n % forms.length]}@example.com`;
};

const phoneGen: Generator = (seed, ctx) => {
  const rng = createRNG(seed);
  const d4 = () => String(rng.int(0, 9999)).padStart(4, '0');
  switch (ctx.locale) {
    case 'en':
      return `(${rng.int(200, 989)}) 555-01${String(rng.int(0, 99)).padStart(2, '0')}`;
    case 'ja':
      return `090-${d4()}-${d4()}`;
    case 'zh':
      return `1${rng.int(3, 9)}${String(rng.int(0, 999999999)).padStart(9, '0')}`;
    default:
      return `010-${d4()}-${d4()}`;
  }
};

const PATH_OVERRIDES: Record<string, Generator> = {
  'internet.email': emailGen,
  'phone.number': phoneGen,
};

// ---------------------------------------------------------------------------
// mask.* — 마스킹된 개인정보. 실서비스가 가려서 내려주는 응답을 흉내낸다.
// 원본 생성기와 같은 시드를 쓰므로 같은 URL 이면 마스킹 값도 항상 같다.
// ---------------------------------------------------------------------------

const maskName: Generator = (seed, ctx) => {
  const f = FAKERS[ctx.locale];
  f.seed(seed);
  const name = String(f.person.fullName());
  if (name.includes(' ')) {
    // 라틴계: 이름(첫 토큰)만 가린다 — "J*** Smith"
    const [first, ...rest] = name.split(' ');
    return [first[0] + '***', ...rest].join(' ');
  }
  // CJK: 첫·끝 글자만 남기고 가운데를 가린다 — "김*준" (2글자는 "김*")
  const ch = [...name];
  if (ch.length <= 1) return name;
  if (ch.length === 2) return ch[0] + '*';
  return ch[0] + '*'.repeat(ch.length - 2) + ch[ch.length - 1];
};

const maskEmail: Generator = (seed, ctx) => {
  const email = String(emailGen(seed, ctx));
  const at = email.indexOf('@');
  const local = email.slice(0, at);
  return local.slice(0, local.length >= 3 ? 2 : 1) + '***' + email.slice(at);
};

const maskPhone: Generator = (seed, ctx) => {
  const phone = String(phoneGen(seed, ctx));
  const runs = [...phone.matchAll(/\d+/g)];
  if (runs.length >= 3) {
    // 구분자 있는 형식: 첫·끝 그룹만 남긴다 — "010-****-5678", "(212) ***-0187"
    let out = phone;
    for (let i = runs.length - 2; i >= 1; i--) {
      const r = runs[i];
      out = out.slice(0, r.index) + '*'.repeat(r[0].length) + out.slice(r.index! + r[0].length);
    }
    return out;
  }
  // 구분자 없는 형식(zh 등): 앞 3 + 가운데 * + 뒤 4 — "139****5678"
  return phone.slice(0, 3) + '*'.repeat(Math.max(0, phone.length - 7)) + phone.slice(phone.length - 4);
};

const maskCard: Generator = (seed) => {
  return `****-****-****-${String(createRNG(seed).int(0, 9999)).padStart(4, '0')}`;
};

const MASK_TYPES: Record<string, Generator> = {
  'mask.name': maskName,
  'mask.email': maskEmail,
  'mask.phone': maskPhone,
  'mask.card': maskCard,
};

function compileFakerPath(raw: string): Generator {
  const masked = MASK_TYPES[raw];
  if (masked) return masked;
  if (raw.startsWith('mask.')) {
    fail('Unknown mask type', raw,
      `지원하는 마스킹 타입: ${Object.keys(MASK_TYPES).join(', ')}`,
      `Supported mask types: ${Object.keys(MASK_TYPES).join(', ')}`);
  }
  const override = PATH_OVERRIDES[raw];
  if (override) return override;
  const segs = raw.split('.');
  if (segs.length !== 2 || !segs[0] || !segs[1]) {
    fail('Invalid faker path', raw,
      "faker 경로는 '모듈.메서드' 2단계입니다. 예: person.fullName",
      "A faker path has two segments: 'module.method', e.g. person.fullName");
  }
  const [mod, method] = segs;
  const notFound = () =>
    fail('Unknown faker path', raw,
      `'${raw}' 를 찾을 수 없습니다. GET /schema/types 에서 지원 목록을 확인하세요.`,
      `'${raw}' was not found. See GET /schema/types for the supported list.`);
  if (mod.startsWith('_') || method.startsWith('_') || DENY_MODULES.has(mod)) notFound();
  const m = (FAKERS.en as unknown as Record<string, unknown>)[mod];
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
  if (!m) fail('Invalid int range', raw, RANGE_HINT('int', '20~60'), RANGE_HINT_EN('int', '20~60'));
  const min = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (min > max) fail('Invalid int range', raw, `최솟값(${min})이 최댓값(${max})보다 큽니다.`, `min (${min}) is greater than max (${max}).`);
  return (seed) => createRNG(seed).int(min, max);
}

function compileFloat(rest: string, raw: string): Generator {
  const parts = rest.split(':');
  if (parts.length > 2) fail('Invalid float spec', raw,
    '형식: float:min~max 또는 float:min~max:자릿수. 예: float:0~100:2',
    'Format: float:min~max or float:min~max:decimals, e.g. float:0~100:2');
  const m = parts[0].match(/^(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)$/);
  if (!m) fail('Invalid float range', raw, RANGE_HINT('float', '0~100:2'), RANGE_HINT_EN('float', '0~100:2'));
  const min = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  if (min > max) fail('Invalid float range', raw, `최솟값(${min})이 최댓값(${max})보다 큽니다.`, `min (${min}) is greater than max (${max}).`);
  let decimals = 2;
  if (parts.length === 2) {
    const d = parseIntStrict(parts[1]);
    if (d === null || d < 0 || d > 10) fail('Invalid float decimals', raw,
      '소수점 자릿수는 0~10 사이 정수입니다. 예: float:0~100:2',
      'Decimals must be an integer between 0 and 10, e.g. float:0~100:2');
    decimals = d;
  }
  return (seed) => parseFloat(createRNG(seed).float(min, max).toFixed(decimals));
}

function compileBool(rest: string, raw: string): Generator {
  let prob = 0.5;
  if (rest !== '') {
    const p = parseNumStrict(rest);
    if (p === null || p < 0 || p > 1) fail('Invalid bool probability', raw,
      'true 확률은 0~1 사이 숫자입니다. 예: bool:0.8',
      'The probability of true must be a number between 0 and 1, e.g. bool:0.8');
    prob = p;
  }
  return (seed) => createRNG(seed).next() < prob;
}

function compileEnum(rest: string, raw: string): Generator {
  const members = rest.split('|');
  if (rest === '' || members.some((v) => v === '')) {
    fail('Invalid enum values', raw,
      "'|' 로 구분한 값 목록이 필요합니다. 예: enum:admin|user|guest (가중치: enum:paid*8|refund*2)",
      "Provide a '|'-separated list of values, e.g. enum:admin|user|guest (weighted: enum:paid*8|refund*2)");
  }
  // 가중치 파싱 — 멤버 끝의 '*숫자'. 하나도 없으면 기존 균등 선택 경로(기존 URL 결정성 유지)
  let weighted = false;
  const values: string[] = [];
  const weights: number[] = [];
  for (const m of members) {
    const wm = m.match(/^(.+)\*(\d+(?:\.\d+)?)$/);
    if (wm) {
      const w = parseFloat(wm[2]);
      if (w <= 0) fail('Invalid enum weight', raw,
        `가중치는 0보다 커야 합니다: '${m}'. 예: enum:paid*8|refund*2`,
        `Weights must be greater than 0: '${m}', e.g. enum:paid*8|refund*2`);
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
  if (rest === '') fail('Invalid pattern', raw,
    '템플릿이 필요합니다. #=숫자, ?=대문자, *=영숫자, 나머지는 그대로. 예: pattern:ORD-####-???',
    'A template is required. #=digit, ?=uppercase, *=alphanumeric, everything else is literal, e.g. pattern:ORD-####-???');
  if (rest.length > 64) fail('Invalid pattern', raw, '템플릿은 최대 64자입니다.', 'Templates are limited to 64 characters.');
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
  if (len === null || len < 1 || len > 10000) fail('Invalid text length', raw,
    '길이는 1~10000 사이 정수입니다. 예: text:50',
    'Length must be an integer between 1 and 10000, e.g. text:50');
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
  if (!m) fail('Invalid image size', raw, '형식: image:너비x높이. 예: image:200x200', 'Format: image:WIDTHxHEIGHT, e.g. image:200x200');
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (w < 1 || h < 1 || w > 4000 || h > 4000) fail('Invalid image size', raw, '크기는 1~4000 사이입니다.', 'Dimensions must be between 1 and 4000.');
  return (seed) => `https://picsum.photos/seed/${seed.toString(36)}/${w}/${h}`;
}

function compileDate(rest: string, raw: string): Generator {
  const m = rest.match(/^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/);
  if (!m) fail('Invalid date range', raw,
    "형식: date:YYYY-MM-DD~YYYY-MM-DD. 범위 구분자는 '~' 입니다. 예: date:2020-01-01~2024-12-31",
    "Format: date:YYYY-MM-DD~YYYY-MM-DD. Use '~' as the range separator, e.g. date:2020-01-01~2024-12-31");
  const from = Date.parse(m[1] + 'T00:00:00.000Z');
  const to = Date.parse(m[2] + 'T23:59:59.999Z');
  if (Number.isNaN(from) || Number.isNaN(to)) fail('Invalid date', raw,
    '유효한 날짜가 아닙니다. 예: date:2020-01-01~2024-12-31',
    'Not a valid date, e.g. date:2020-01-01~2024-12-31');
  if (from > to) fail('Invalid date range', raw, '시작일이 종료일보다 늦습니다.', 'The start date is after the end date.');
  return (seed) => new Date(createRNG(seed).int(from, to)).toISOString();
}

// ---------------------------------------------------------------------------
// pk / ref — 리소스 간 관계 (orders.userId ↔ users.id)
//
// 두 URL 이 서로를 모른 채 같은 값을 내야 하므로, 시드를 "리소스 이름 + 인덱스"
// 에서만 파생한다. pk 는 필드 시드(스키마 전체에 좌우됨)를 버리고, ref 는 필드
// 시드로 인덱스 하나만 고른 뒤 같은 파생을 거친다 — 그래서 어느 쪽 스키마에
// 필드를 더해도 관계는 깨지지 않는다. 저장소·상대 URL 조회가 없는 순수 함수.
// ---------------------------------------------------------------------------

const RES_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_REF_COUNT = 1_000_000; // _total 상한과 같은 값

/** (리소스, 인덱스) → uuid. pk 와 ref 가 공유하는 유일한 진실 */
const pkValue = (name: string, index: number): string => uuidFromSeed(hashString(`pk:${name}:${index}`));

function compilePk(rest: string, raw: string): Generator {
  if (!RES_NAME_RE.test(rest)) {
    fail('Invalid pk resource', raw,
      "형식: pk:리소스명 (영문 시작, 영숫자/_/-, 64자 이내). 예: id=pk:users — 다른 리소스가 ref:users 로 참조합니다.",
      "Format: pk:resource (letter first, alphanumerics/_/-, up to 64 chars), e.g. id=pk:users — other resources reference it with ref:users.");
  }
  return (_seed, ctx) => pkValue(rest, ctx.globalIndex);
}

function compileRef(rest: string, raw: string): Generator {
  const parts = rest.split(':');
  if (parts.length > 2 || !RES_NAME_RE.test(parts[0])) {
    fail('Invalid ref spec', raw,
      "형식: ref:리소스명 또는 ref:리소스명:총원. 예: userId=ref:users — id=pk:users 인 리소스의 값 중 하나가 나옵니다.",
      "Format: ref:resource or ref:resource:count, e.g. userId=ref:users — yields one of the values of a resource with id=pk:users.");
  }
  let count = 100; // 기본 100 = _total 기본값 — 대상 리소스의 앞 100개를 가리킨다
  if (parts.length === 2) {
    const n = parseIntStrict(parts[1]);
    if (n === null || n < 1 || n > MAX_REF_COUNT) {
      fail('Invalid ref count', raw,
        `총원은 1~${MAX_REF_COUNT.toLocaleString('en-US')} 사이 정수입니다 — 대상 리소스의 _total 과 맞추세요. 예: ref:users:500`,
        `Count must be an integer between 1 and ${MAX_REF_COUNT.toLocaleString('en-US')} — match the target resource's _total, e.g. ref:users:500`);
    }
    count = n;
  }
  const name = parts[0];
  return (seed) => pkValue(name, createRNG(seed).int(0, count - 1));
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
      if (rest !== '') fail('Invalid uuid spec', raw,
        "uuid 는 인자를 받지 않습니다. 'uuid' 로만 쓰세요.",
        "uuid takes no arguments — write just 'uuid'.");
      return (seed) => uuidFromSeed(seed);
    case 'index':
      if (rest !== '') fail('Invalid index spec', raw,
        "index 는 인자를 받지 않습니다. 'index' 로만 쓰세요.",
        "index takes no arguments — write just 'index'.");
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
    case 'pk':
      return compilePk(rest, raw);
    case 'ref':
      return compileRef(rest, raw);
    default:
      if (raw.includes('.')) return compileFakerPath(raw);
      fail(
        'Unknown field type',
        raw,
        `지원 타입: ${KNOWN_TYPES}. faker 경로는 'person.fullName' 처럼 '모듈.메서드' 형태입니다. 전체 목록: GET /schema/types`,
        `Supported types: ${KNOWN_TYPES}. Faker paths use 'module.method' form like 'person.fullName'. Full list: GET /schema/types`,
      );
  }
}

// ---------------------------------------------------------------------------
// /schema/types 응답 — 서버 레지스트리와 GUI의 단일 소스
// ---------------------------------------------------------------------------

export const TYPE_DOCS = {
  reserved: [
    { name: '_page', default: '1', desc: '페이지 번호 (1-base)' },
    { name: '_limit', default: '10', desc: '페이지당 항목 수 (최대 1000)' },
    { name: '_total', default: '100', desc: '전체 항목 수 (가상)' },
    { name: '_seed', default: 'URL 해시', desc: '명시하면 고정 시드 사용' },
    { name: '_locale', default: 'ko', desc: 'ko | en | ja | zh' },
    { name: '_delay', default: '0', desc: '응답 지연 ms (최대 5000)' },
    { name: '_status', default: '200', desc: '강제 HTTP 상태코드. 400 이상이면 데이터 대신 실패 바디가 나갑니다' },
    { name: '_method', default: '실제 요청 verb', desc: 'GET | POST | PUT | PATCH | DELETE — POST 는 201+단건, PUT/PATCH 는 200+단건, DELETE 는 204. 명시하면 실제 verb 보다 우선' },
    { name: '_body', default: '—', desc: '실패 응답 바디 (JSON 원문, 최대 2000자). _status 가 400 이상일 때만. 예: _status=401&_body={"code":"E_AUTH"}' },
    { name: '_wrap', default: 'envelope', desc: 'envelope | none(배열만) | one(단일 객체 — 상세 API 용)' },
    { name: '_format', default: 'json', desc: 'json | ndjson | csv — ndjson/csv 는 아이템만 스트리밍 (대용량용)' },
    { name: '_q', default: '—', desc: '검색어 — 모든 값에 부분일치(대소문자 무시). total 은 매치 수. 앞 1,000개 창 안에서 검색' },
    { name: '_qin', default: '—', desc: '검색 대상 필드 한정 (쉼표 구분, 중첩은 a.b). _q 와 함께 사용. 예: _q=김&_qin=name,city' },
    { name: '_sort', default: '—', desc: "정렬 (쉼표 구분, '-' 접두사는 내림차순, 중첩은 a.b). 데이터는 그대로고 순서만 바뀝니다. 앞 1,000개 창 안에서 정렬. 예: _sort=name,-age" },
    { name: '_alias', default: '—', desc: '예약 파라미터 별칭 — 실제 API 의 키 이름으로 호출. 예: _alias=page:_page,size:_limit → ?page=2&size=20' },
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
    { type: 'pk', syntax: 'pk:리소스명', example: 'pk:users', label: '기본 키 — 관계용 결정적 uuid' },
    { type: 'ref', syntax: 'ref:리소스명[:총원]', example: 'ref:users', label: '다른 리소스의 pk 참조 (외래 키)' },
  ],
  fakerPaths: [
    { value: 'person.fullName', label: '이름(전체)' },
    { value: 'person.firstName', label: '이름' },
    { value: 'person.lastName', label: '성' },
    { value: 'person.jobTitle', label: '직함' },
    { value: 'internet.email', label: '이메일 (@example.com — 실존 불가 보장)' },
    { value: 'internet.url', label: 'URL' },
    { value: 'internet.ip', label: 'IP 주소' },
    { value: 'phone.number', label: '전화번호 (010-####-#### 형식)' },
    { value: 'mask.name', label: '마스킹된 이름 (김*준)' },
    { value: 'mask.email', label: '마스킹된 이메일 (mi***@example.com)' },
    { value: 'mask.phone', label: '마스킹된 전화 (010-****-5678)' },
    { value: 'mask.card', label: '마스킹된 카드번호 (****-****-****-4821)' },
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

// ---------------------------------------------------------------------------
// TYPE_DOCS 영어판 — 한국어 원본과 구조 완전 동일 (name/value/type/example 은 그대로,
// 라벨·설명만 교체). GUI 가 fakerPaths[].value/label 을 그대로 소비하므로 사본으로 만든다.
// ---------------------------------------------------------------------------

/** /schema/types 응답의 공용 형태 — ko(as const 리터럴)/en(사본) 둘 다 여기에 맞는다 */
export interface TypeDocs {
  reserved: ReadonlyArray<{ name: string; default: string; desc: string }>;
  dslTypes: ReadonlyArray<{ type: string; syntax: string; example: string; label: string }>;
  fakerPaths: ReadonlyArray<{ value: string; label: string }>;
  arrays: { syntax: string; example: string; desc: string };
  nested: { syntax: string; example: string; desc: string };
}

const EN_RESERVED: Record<string, { default?: string; desc: string }> = {
  _page: { desc: 'Page number (1-based)' },
  _limit: { desc: 'Items per page (max 1000)' },
  _total: { desc: 'Total item count (virtual)' },
  _seed: { default: 'URL hash', desc: 'Set explicitly to pin the seed' },
  _locale: { desc: 'ko | en | ja | zh' },
  _delay: { desc: 'Response delay in ms (max 5000)' },
  _status: { desc: 'Forced HTTP status code. At 400 or above a failure body replaces the data' },
  _method: { default: 'actual request verb', desc: 'GET | POST | PUT | PATCH | DELETE — POST returns 201 + a single item, PUT/PATCH 200 + a single item, DELETE 204. Takes precedence over the actual verb' },
  _body: { desc: 'Failure response body (raw JSON, max 2000 chars). Only with _status 400 or above, e.g. _status=401&_body={"code":"E_AUTH"}' },
  _wrap: { desc: 'envelope | none (array only) | one (single object — for detail APIs)' },
  _format: { desc: 'json | ndjson | csv — ndjson/csv stream items only (for large payloads)' },
  _q: { desc: 'Search term — partial match on every value (case-insensitive). total is the match count. Searches within the first 1,000 items' },
  _qin: { desc: 'Restrict search to specific fields (comma-separated, nested as a.b). Use with _q, e.g. _q=kim&_qin=name,city' },
  _sort: { desc: "Sort (comma-separated, '-' prefix for descending, nested as a.b). The data is unchanged — only the order. Sorts within the first 1,000 items, e.g. _sort=name,-age" },
  _alias: { desc: "Aliases for reserved parameters — call with your real API's key names, e.g. _alias=page:_page,size:_limit → ?page=2&size=20" },
  _s: { desc: 'Saved team schema ID. Other parameters can override it (e.g. ?_s=aB3xK9&_page=2)' },
};

/** dslTypes 와 같은 순서의 영어 syntax/label (positional — TYPE_DOCS.dslTypes 순서와 1:1) */
const EN_DSL: ReadonlyArray<{ syntax: string; label: string }> = [
  { syntax: 'int:min~max', label: 'Integer range' },
  { syntax: 'float:min~max[:decimals]', label: 'Float range' },
  { syntax: 'bool[:trueProbability]', label: 'Boolean' },
  { syntax: 'enum:a|b|c', label: 'Pick one of enum values' },
  { syntax: 'const:value', label: 'Fixed literal' },
  { syntax: 'text:length', label: 'String of given length' },
  { syntax: 'image:WxH', label: 'Image URL' },
  { syntax: 'date:start~end', label: 'Date (ISO)' },
  { syntax: 'uuid', label: 'UUID v4' },
  { syntax: 'index', label: 'Global index (0,1,2…)' },
  { syntax: 'pattern:template (#=digit ?=uppercase *=alphanumeric)', label: 'Pattern string' },
  { syntax: 'enum:a*weight|b*weight', label: 'Weighted enum' },
  { syntax: 'anyType?probability', label: 'Mix in nulls (modifier)' },
  { syntax: 'pk:resource', label: 'Primary key — deterministic uuid for relations' },
  { syntax: 'ref:resource[:count]', label: "Reference to another resource's pk (foreign key)" },
];

const EN_FAKER_LABELS: Record<string, string> = {
  'person.fullName': 'Full name',
  'person.firstName': 'First name',
  'person.lastName': 'Last name',
  'person.jobTitle': 'Job title',
  'internet.email': 'Email (@example.com — guaranteed non-deliverable)',
  'internet.url': 'URL',
  'internet.ip': 'IP address',
  'phone.number': 'Phone number (010-####-#### format)',
  'mask.name': 'Masked name (J*** Smith)',
  'mask.email': 'Masked email (mi***@example.com)',
  'mask.phone': 'Masked phone (010-****-5678)',
  'mask.card': 'Masked card number (****-****-****-4821)',
  'location.city': 'City',
  'location.streetAddress': 'Street address',
  'location.zipCode': 'ZIP code',
  'location.country': 'Country',
  'company.name': 'Company name',
  'commerce.productName': 'Product name',
  'commerce.department': 'Product category',
  'lorem.word': 'Word',
  'lorem.sentence': 'Sentence',
  'lorem.paragraph': 'Paragraph',
  'string.alphanumeric': 'Alphanumeric string',
  'color.rgb': 'Color (rgb)',
};

const TYPE_DOCS_EN: TypeDocs = {
  reserved: TYPE_DOCS.reserved.map((r) => ({
    name: r.name,
    default: EN_RESERVED[r.name]?.default ?? r.default,
    desc: EN_RESERVED[r.name]?.desc ?? r.desc,
  })),
  dslTypes: TYPE_DOCS.dslTypes.map((d, i) => ({
    type: d.type,
    syntax: EN_DSL[i]?.syntax ?? d.syntax,
    example: d.example,
    label: EN_DSL[i]?.label ?? d.label,
  })),
  fakerPaths: TYPE_DOCS.fakerPaths.map((f) => ({ value: f.value, label: EN_FAKER_LABELS[f.value] ?? f.label })),
  arrays: {
    syntax: 'name[]=type:count',
    example: TYPE_DOCS.arrays.example,
    desc: "Array field. A trailing ':integer' in the value sets the array length (default 3, max 100)",
  },
  nested: { syntax: 'a.b=type', example: TYPE_DOCS.nested.example, desc: 'Dot notation → nested object' },
};

/** /schema/types 를 언어별로 — 'ko' 는 기존 TYPE_DOCS 그대로 (하위호환) */
export function typeDocsFor(lang: 'ko' | 'en'): TypeDocs {
  return lang === 'en' ? TYPE_DOCS_EN : TYPE_DOCS;
}
