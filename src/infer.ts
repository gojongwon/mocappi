/**
 * JSON 예시 → 스키마 자동 추론.
 * 실제 API 응답을 붙여넣으면 필드·타입을 추론해 DSL 로 변환한다.
 * 추론이 애매하면 보수적으로 (text/lorem.word) 떨어지고, 불가능하면 skipped 로 알려준다.
 */
import { DslError, compileType } from './registry';

export interface InferredField {
  name: string;
  type: string;
}

export interface InferResult {
  fields: InferredField[];
  skipped: Array<{ path: string; reason: string }>;
  /** 추론 방식 안내 (예: "items 배열 15개 항목을 병합해 추론") */
  note?: string;
}

const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATE_RE = /^(\d{4})-\d{2}-\d{2}([T ].*)?$/;
const URL_RE = /^https?:\/\//i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;
const MAX_DEPTH = 5;
const MAX_FIELDS = 100;

/** 값 기준 "그럴듯한" 정수 상한 */
function niceMax(v: number): number {
  const a = Math.max(1, Math.abs(v));
  for (const c of [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]) {
    if (a <= c) return c;
  }
  return Math.ceil(a / 1000) * 2000;
}

function clampLen(n: number): number {
  return Math.min(500, Math.max(5, n));
}

/** URL 에서 WxH 추출 (picsum, placehold 등) */
function imageSize(url: string): string {
  const m = url.match(/\/(\d{2,4})\/(\d{2,4})(\/|\?|#|$)/) || url.match(/(\d{2,4})x(\d{2,4})/);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w >= 10 && h >= 10 && w <= 4000 && h <= 4000) return `image:${w}x${h}`;
  }
  return 'image:200x200';
}

const KEY = {
  image: /(avatar|image|img|thumbnail|thumb|photo|picture|logo|icon)$/,
  email: /email$/,
  phone: /(phone|tel|mobile)$/,
  name: /^(name|fullname)$/,
  firstName: /^firstname$/,
  lastName: /^lastname$/,
  city: /city$/,
  country: /country$/,
  zip: /(zip|zipcode|postalcode|postcode)$/,
  address: /(address|street)$/,
  company: /(company|corp|organization|org)$/,
  job: /(job|jobtitle|position)$/,
  enumish: /(status|type|role|category|level|grade|tier|state|kind)$/,
  longText: /(description|desc|bio|content|memo|comment|summary|body|text|message)$/,
  url: /(url|link|website|homepage)$/,
};

// 마스킹된 값 감지 — 실서비스 응답의 가려진 개인정보 ("김*준", "mi***@example.com")
// 카드가 가장 구체적이므로 먼저, 전화는 카드 이후에 검사해야 오검출이 없다.
const MASK_CARD_RE = /^(?:\*{4}[- ]){3}\d{4}$/;
const MASK_EMAIL_RE = /^[A-Za-z0-9._%+-]{1,4}\*{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MASK_PHONE_RE = /^\+?[\d()\- ]*\*{2,}[\d()*\- ]*\d{2,4}$/;
const MASK_NAME_CJK_RE = /^[^\x00-\x7F]\*+[^\x00-\x7F]?$/;
const MASK_NAME_LATIN_RE = /^[A-Za-z]\*{2,}(?: [A-Za-z][A-Za-z'.-]*)+$/;

function inferMasked(v: string): string | null {
  if (MASK_CARD_RE.test(v)) return 'mask.card';
  if (MASK_EMAIL_RE.test(v)) return 'mask.email';
  if (MASK_PHONE_RE.test(v)) return 'mask.phone';
  if (MASK_NAME_CJK_RE.test(v) || MASK_NAME_LATIN_RE.test(v)) return 'mask.name';
  return null;
}

/** 값/키가 특정 의미를 강하게 가리키는 경우 (uuid/email/date/url/faker 매핑) — 아니면 null */
function inferStringKeyed(keyLc: string, v: string): string | null {
  if (v.includes('*')) {
    const masked = inferMasked(v);
    if (masked) return masked;
  }
  if (UUID_RE.test(v)) return 'uuid';
  if (EMAIL_RE.test(v) || KEY.email.test(keyLc)) return 'internet.email';
  const dm = v.match(ISO_DATE_RE);
  if (dm && !Number.isNaN(Date.parse(v))) {
    const y = parseInt(dm[1], 10);
    return `date:${y}-01-01~${y}-12-31`;
  }
  if (URL_RE.test(v)) {
    if (KEY.image.test(keyLc) || IMAGE_EXT_RE.test(v)) return imageSize(v);
    return 'internet.url';
  }
  if (KEY.phone.test(keyLc)) return 'phone.number';
  if (KEY.firstName.test(keyLc)) return 'person.firstName';
  if (KEY.lastName.test(keyLc)) return 'person.lastName';
  if (KEY.name.test(keyLc)) return 'person.fullName';
  if (KEY.city.test(keyLc)) return 'location.city';
  if (KEY.country.test(keyLc)) return 'location.country';
  if (KEY.zip.test(keyLc)) return 'location.zipCode';
  if (KEY.address.test(keyLc)) return 'location.streetAddress';
  if (KEY.company.test(keyLc)) return 'company.name';
  if (KEY.job.test(keyLc)) return 'person.jobTitle';
  if (KEY.longText.test(keyLc)) return `text:${clampLen(v.length)}`;
  return null;
}

/** 특정 의미가 없을 때의 보수적 폴백 */
function inferStringTail(keyLc: string, v: string): string {
  if (KEY.enumish.test(keyLc) && v !== '' && !/[|\s]/.test(v)) return `enum:${v}`;
  if (v === '') return 'const:';
  if (!/\s/.test(v) && v.length <= 15) return 'lorem.word';
  return `text:${clampLen(v.length)}`;
}

function inferString(keyLc: string, v: string): string {
  return inferStringKeyed(keyLc, v) ?? inferStringTail(keyLc, v);
}

function inferNumber(keyLc: string, v: number): string {
  if (Number.isInteger(v)) {
    if (keyLc === 'id' || keyLc.endsWith('index') || keyLc === 'seq' || keyLc === 'sequence' || keyLc === 'no') return 'index';
    if (keyLc === 'age') return 'int:18~65';
    if (v >= 1000000000 && v <= 9999999999999) {
      // epoch 타임스탬프로 보이면 최근 범위 날짜로
      return 'date:2024-01-01~2026-12-31';
    }
    const hi = niceMax(v);
    const lo = v < 0 ? -hi : 0;
    return `int:${lo}~${hi}`;
  }
  const decimals = Math.min(4, Math.max(1, (String(v).split('.')[1] || '').length));
  const hi = niceMax(v);
  const lo = v < 0 ? -hi : 0;
  return `float:${lo}~${hi}:${decimals}`;
}

function inferScalar(key: string, v: unknown): string {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return inferNumber(key.toLowerCase(), v);
  if (typeof v === 'string') return inferString(key.toLowerCase(), v);
  return `const:${String(v)}`;
}

// ---------------------------------------------------------------------------
// 컬럼 샘플 기반 고급 감지 — 여러 항목의 같은 필드 값들을 보고
// enum(반복 값) / pattern(코드 형태) / 분포(bool 확률, 숫자 범위)를 추론한다.
// ---------------------------------------------------------------------------

const round1 = (x: number): number => Math.round(x * 10) / 10;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** enum 값으로 안전한 문자열 — '|'(구분자), '*'(가중치), '?'(nullable), 공백 제외 */
const ENUM_SAFE_RE = /^[^|*?\s]{1,24}$/;

/** 반복되는 소수의 문자열 값 → enum. 빈도가 뚜렷이 다르면 표본 개수를 가중치로 */
function tryEnum(keyLc: string, vals: string[]): string | null {
  if (vals.length < 3) return null;
  if (!vals.every((v) => ENUM_SAFE_RE.test(v))) return null;
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const distinct = counts.size;
  const strongRepeat = distinct <= 6 && distinct <= Math.ceil(vals.length / 2);
  const enumishKey = KEY.enumish.test(keyLc) && distinct <= 6;
  if (distinct < 2 || !(strongRepeat || enumishKey)) return null;
  // 빈도 내림차순(동률은 사전순) — 입력 순서와 무관하게 결정적
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const ws = entries.map((e) => e[1]);
  if (ws[0] < ws[ws.length - 1] * 2) return `enum:${entries.map((e) => e[0]).join('|')}`;
  const g = ws.reduce((a, b) => gcd(a, b));
  return `enum:${entries.map(([v, c]) => `${v}*${c / g}`).join('|')}`;
}

const PATTERN_CHARS_RE = /^[A-Z0-9\-_/.:]+$/;
const KEY_CODE = /(sku|code|serial|ref|reference|invoice|tracking|voucher|coupon|orderno)$/;

/** 같은 길이·같은 구조의 대문자/숫자 코드 → pattern 템플릿 (#숫자 ?대문자 *영숫자) */
function tryPattern(keyLc: string, vals: string[]): string | null {
  if (vals.length < 2) return null;
  const L = vals[0].length;
  if (L < 4 || L > 32) return null;
  if (!vals.every((v) => v.length === L && PATTERN_CHARS_RE.test(v))) return null;
  let tpl = '';
  let wildcards = 0;
  let literals = 0;
  for (let i = 0; i < L; i++) {
    const chars = vals.map((v) => v[i]);
    const digits = chars.filter((c) => c >= '0' && c <= '9').length;
    const uppers = chars.filter((c) => c >= 'A' && c <= 'Z').length;
    if (digits === chars.length) {
      tpl += '#';
      wildcards++;
    } else if (chars.every((c) => c === chars[0])) {
      tpl += chars[0]; // 모두 같은 문자(구분자 포함) → 리터럴
      literals++;
    } else if (uppers === chars.length) {
      tpl += '?';
      wildcards++;
    } else if (digits + uppers === chars.length) {
      tpl += '*';
      wildcards++;
    } else {
      return null; // 구분자 위치가 흔들림 — 패턴 아님
    }
  }
  if (wildcards < 2 || !(literals >= 1 || KEY_CODE.test(keyLc))) return null;
  return `pattern:${tpl}`;
}

/** 숫자 표본 → 실측 범위 기반 int/float (특수 키/epoch 은 기존 단일값 로직 우선) */
function inferNumberSamples(keyLc: string, rep: number, nums: number[]): string {
  if (
    Number.isInteger(rep) &&
    (keyLc === 'id' || keyLc.endsWith('index') || keyLc === 'seq' || keyLc === 'sequence' ||
      keyLc === 'no' || keyLc === 'age' || (rep >= 1000000000 && rep <= 9999999999999))
  ) {
    return inferNumber(keyLc, rep);
  }
  const hi = niceMax(Math.max(...nums.map((v) => Math.abs(v))));
  const lo = Math.min(...nums) < 0 ? -hi : 0;
  if (nums.every((v) => Number.isInteger(v))) return `int:${lo}~${hi}`;
  const decimals = Math.min(4, Math.max(1, ...nums.map((v) => (String(v).split('.')[1] || '').length)));
  return `float:${lo}~${hi}:${decimals}`;
}

/** 표본이 2개 이상일 때의 스칼라 추론 — 단일값 추론보다 우선 적용 */
function inferScalarSamples(key: string, rep: unknown, nonNull: unknown[]): string {
  const keyLc = key.toLowerCase();
  if (typeof rep === 'string' && nonNull.every((v) => typeof v === 'string')) {
    const keyed = inferStringKeyed(keyLc, rep);
    if (keyed) return keyed;
    const vals = nonNull as string[];
    return tryEnum(keyLc, vals) ?? tryPattern(keyLc, vals) ?? inferStringTail(keyLc, rep);
  }
  if (typeof rep === 'number' && nonNull.every((v) => typeof v === 'number')) {
    return inferNumberSamples(keyLc, rep, nonNull as number[]);
  }
  if (typeof rep === 'boolean' && nonNull.length >= 5 && nonNull.every((v) => typeof v === 'boolean')) {
    const r = round1((nonNull as boolean[]).filter(Boolean).length / nonNull.length);
    return r === 0.5 ? 'bool' : `bool:${r}`;
  }
  return inferScalar(key, rep);
}

const WRAP_KEYS = new Set([
  'data', 'items', 'results', 'result', 'list', 'rows', 'records', 'content', 'payload', 'response', 'body',
]);
const MERGE_SAMPLES = 20;
const SCAN_DEPTH = 4;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 여러 샘플 항목을 하나로 병합 — 앞 항목에서 null 인 필드를 뒤 항목 값으로 메꾼다.
 * 실제 API 응답은 항목마다 null 이 많아 첫 항목만 보면 추론이 빈약해진다.
 */
function mergeSamples(arr: unknown[]): Obj {
  const out: Obj = {};
  for (const o of arr.slice(0, MERGE_SAMPLES)) {
    if (isObj(o)) mergeInto(out, o);
  }
  return out;
}

function mergeInto(dst: Obj, src: Obj): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = dst[k];
    if (cur === undefined || cur === null) {
      dst[k] = isObj(v) ? mergeSamples([v]) : v ?? null;
    } else if (isObj(cur) && isObj(v)) {
      mergeInto(cur, v); // 중첩 객체도 필드 단위로 병합 (survey_id 등)
    } else if (Array.isArray(cur) && cur.length === 0 && Array.isArray(v) && v.length > 0) {
      dst[k] = v; // 빈 배열은 비어있지 않은 샘플로 대체
    }
    // 이미 non-null 스칼라면 첫 샘플 유지
  }
}

/**
 * 트리 전체(깊이 4)에서 "항목 배열"을 찾는다 — {data: {items: [...]}} 같은
 * 이중 envelope 도 처리. 알려진 래퍼 키({data,items,...}) + 배열 길이로 점수를 매겨
 * 가장 그럴듯한 배열을 고르고, 샘플들을 병합해 반환한다.
 */
function findItemsArray(root: unknown): { merged: Obj; items: Obj[]; key: string; count: number } | null {
  let best: { merged: Obj; items: Obj[]; key: string; count: number; score: number } | null = null;
  const visit = (v: unknown, key: string, depth: number): void => {
    if (depth > SCAN_DEPTH || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      // 루트 배열이거나 알려진 래퍼 키일 때만 "항목 배열"로 승격 —
      // orders 같은 일반 필드의 객체 배열은 스키마의 일부로 남긴다(skipped 안내)
      if (v.some(isObj) && (key === '' || WRAP_KEYS.has(key.toLowerCase()))) {
        const score = 100 + Math.min(v.length, 50) - depth * 2;
        if (!best || score > best.score) {
          const items = v.filter(isObj);
          best = { merged: mergeSamples(items), items, key: key || '(루트)', count: v.length, score };
        }
      }
      return; // 배열 내부는 더 내려가지 않음
    }
    for (const [k, w] of Object.entries(v)) visit(w, k, depth + 1);
  };
  visit(root, '', 0);
  return best;
}

export function inferSchema(input: unknown): InferResult {
  let root: unknown;
  let note: string | undefined;
  let items: Obj[] = [];

  const found = findItemsArray(input);
  if (found) {
    root = found.merged;
    items = found.items.slice(0, MERGE_SAMPLES);
    note = `'${found.key}' 배열의 ${Math.min(found.count, MERGE_SAMPLES)}개 항목을 병합해 추론했습니다 (null 비율·반복 값·코드 형태는 nullable/enum/pattern 으로 자동 반영).`;
  } else {
    root = input;
  }

  /** 항목 배열에서 경로의 값들을 수집 — 없는/끊긴 경로는 null */
  function samplesAt(path: string): unknown[] {
    if (items.length === 0) return [];
    const segs = path.split('.');
    return items.map((it) => {
      let cur: unknown = it;
      for (const s of segs) {
        if (!isObj(cur)) return null;
        cur = cur[s];
      }
      return cur === undefined ? null : cur;
    });
  }

  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new DslError({
      error: 'Cannot infer schema',
      hint: 'JSON 객체 또는 객체 배열을 붙여넣으세요. 예: {"name": "김민준", "age": 34}',
    });
  }

  const fields: InferredField[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  function walk(obj: Record<string, unknown>, prefix: string, depth: number): void {
    for (const [k, v] of Object.entries(obj)) {
      if (fields.length >= MAX_FIELDS) return;
      const path = prefix ? `${prefix}.${k}` : k;
      if (!FIELD_KEY_RE.test(k)) {
        skipped.push({ path, reason: '필드명 규칙(영문 시작, 영숫자/_)에 맞지 않음' });
        continue;
      }
      if (v === null || v === undefined) {
        skipped.push({ path, reason: 'null 값 — 타입을 추론할 수 없음' });
        continue;
      }
      if (Array.isArray(v)) {
        if (v.length === 0) {
          skipped.push({ path, reason: '빈 배열 — 요소 타입을 알 수 없음' });
        } else if (typeof v[0] === 'object') {
          skipped.push({ path, reason: '객체 배열은 v1 DSL 미지원' });
        } else {
          const itemType = inferScalar(k, v[0]);
          push(`${path}[]`, `${itemType}:${Math.min(v.length, 100)}`, path);
        }
        continue;
      }
      if (typeof v === 'object') {
        if (depth >= MAX_DEPTH) {
          skipped.push({ path, reason: `중첩 ${MAX_DEPTH}단계 초과` });
        } else {
          walk(v as Record<string, unknown>, path, depth + 1);
        }
        continue;
      }
      // 스칼라 리프 — 컬럼 샘플이 있으면 분포 기반 추론 + null 비율 반영
      const samples = samplesAt(path);
      const nonNull = samples.filter((s) => s !== null && typeof s !== 'object');
      let type = nonNull.length >= 2 ? inferScalarSamples(k, v, nonNull) : inferScalar(k, v);
      const nulls = samples.filter((s) => s === null).length;
      if (nulls > 0 && samples.length >= 2) {
        const p = Math.min(0.9, Math.max(0.1, round1(nulls / samples.length)));
        type = `${type}?${p}`;
      }
      push(path, type, path);
    }
  }

  function push(name: string, type: string, path: string): void {
    // 추론 결과가 실제로 컴파일되는지 최종 검증 — 안 되면 보수적 폴백
    const itemType = name.endsWith('[]') ? type.replace(/:\d+$/, '') : type;
    try {
      compileType(itemType);
      fields.push({ name, type });
    } catch {
      const fallback = name.endsWith('[]') ? 'lorem.word:3' : 'text:20';
      fields.push({ name, type: fallback });
      skipped.push({ path, reason: `'${type}' 추론 실패 — '${fallback}' 로 대체` });
    }
  }

  walk(root as Record<string, unknown>, '', 1);

  if (fields.length === 0) {
    throw new DslError({
      error: 'No inferable fields',
      hint: '추론 가능한 필드가 없습니다. 스칼라 값을 가진 키가 하나 이상 필요합니다.',
    });
  }

  return note ? { fields, skipped, note } : { fields, skipped };
}
