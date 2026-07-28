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

function inferString(keyLc: string, v: string): string {
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
  if (KEY.enumish.test(keyLc) && v !== '' && !/[|\s]/.test(v)) return `enum:${v}`;
  if (v === '') return 'const:';
  if (!/\s/.test(v) && v.length <= 15) return 'lorem.word';
  return `text:${clampLen(v.length)}`;
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
function findItemsArray(root: unknown): { merged: Obj; key: string; count: number } | null {
  let best: { merged: Obj; key: string; count: number; score: number } | null = null;
  const visit = (v: unknown, key: string, depth: number): void => {
    if (depth > SCAN_DEPTH || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      // 루트 배열이거나 알려진 래퍼 키일 때만 "항목 배열"로 승격 —
      // orders 같은 일반 필드의 객체 배열은 스키마의 일부로 남긴다(skipped 안내)
      if (v.some(isObj) && (key === '' || WRAP_KEYS.has(key.toLowerCase()))) {
        const score = 100 + Math.min(v.length, 50) - depth * 2;
        if (!best || score > best.score) {
          best = { merged: mergeSamples(v.filter(isObj)), key: key || '(루트)', count: v.length, score };
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

  const found = findItemsArray(input);
  if (found) {
    root = found.merged;
    note = `'${found.key}' 배열의 ${Math.min(found.count, MERGE_SAMPLES)}개 항목을 병합해 추론했습니다 (null 필드는 다른 항목 값으로 보완).`;
  } else {
    root = input;
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
      push(path, inferScalar(k, v), path);
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
