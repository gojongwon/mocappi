/**
 * 쿼리스트링 → ParsedQuery 파싱.
 * '_' 로 시작하는 파라미터는 예약어, 나머지는 전부 필드 정의.
 * 에러 메시지가 곧 문서 역할을 하므로 항상 필드명/값/힌트를 포함한다.
 */
import { compileType, DslError, type Generator, type Locale } from './registry';

export interface FieldSpec {
  /** 원본 파라미터 이름 ([] 포함) — 시드 결합 키로도 사용 */
  name: string;
  /** 점 표기 분해된 경로 ([] 제거) */
  path: string[];
  isArray: boolean;
  arrayLen: number;
  /** 원본 타입 문자열 — 정규화(시드)용 */
  typeRaw: string;
  gen: Generator;
}

export interface ParsedQuery {
  page: number;
  limit: number;
  total: number;
  locale: Locale;
  delay: number;
  status: number;
  wrap: 'envelope' | 'none';
  /** 응답 형식 — ndjson/csv 는 아이템 스트리밍 (envelope 없음) */
  format: 'json' | 'ndjson' | 'csv';
  /** _q 검색어 — 데이터는 동일하고 필터만 적용 (시드 제외). null 이면 검색 없음 */
  q: string | null;
  /** _qin 검색 대상 필드(점 표기 경로) — null 이면 전체 검색. 중첩은 부분트리 매치 */
  qin: string[] | null;
  seedParam: string | null;
  /** name 기준 정렬 완료 상태 */
  fields: FieldSpec[];
  /** baseSeed 계산용 정규화 문자열 (_page/_limit/_delay/_status/_wrap/_format 제외, 정렬됨) */
  normalized: string;
}

const RESERVED_NAMES = ['_page', '_limit', '_total', '_seed', '_locale', '_delay', '_status', '_wrap', '_format', '_q', '_qin'];
const MAX_LIMIT = 1000;
const MAX_DELAY = 5000;
const MAX_ARRAY_LEN = 100;
const DEFAULT_ARRAY_LEN = 3;

const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\[\])?$/;

function fail(error: string, field: string | undefined, value: string, hint: string): never {
  throw new DslError({ error, field, value, hint });
}

function reqInt(name: string, value: string, min: number, max: number): number {
  if (!/^-?\d+$/.test(value)) fail('Invalid reserved parameter', name, value, `${name} 은(는) 정수여야 합니다.`);
  const n = parseInt(value, 10);
  if (n < min || n > max) fail('Invalid reserved parameter', name, value, `${name} 은(는) ${min}~${max} 범위여야 합니다.`);
  return n;
}

/** 배열 필드 값에서 길이 접미사 분리 — 마지막 ':순수 정수' 가 길이 */
export function splitArrayLen(value: string): { itemType: string; len: number } {
  const idx = value.lastIndexOf(':');
  if (idx > 0) {
    const tail = value.slice(idx + 1);
    if (/^\d+$/.test(tail)) {
      const len = parseInt(tail, 10);
      if (len < 1 || len > MAX_ARRAY_LEN) {
        fail('Invalid array length', undefined, value, `배열 길이는 1~${MAX_ARRAY_LEN} 사이입니다. 예: tags[]=lorem.word:3`);
      }
      return { itemType: value.slice(0, idx), len };
    }
  }
  return { itemType: value, len: DEFAULT_ARRAY_LEN };
}

export function parseQuery(params: URLSearchParams): ParsedQuery {
  // 중복 키 검사 — 조용히 하나를 고르면 디버깅이 어려워진다
  const seen = new Set<string>();
  for (const [k] of params) {
    if (seen.has(k)) {
      fail('Duplicate parameter', k, String(params.getAll(k)), `'${k}' 가 두 번 이상 정의됐습니다. 하나만 남기세요.`);
    }
    seen.add(k);
  }

  // 예약 파라미터
  let page = 1;
  let limit = 10;
  let total = 100;
  let locale: Locale = 'ko';
  let delay = 0;
  let status = 200;
  let wrap: 'envelope' | 'none' = 'envelope';
  let format: 'json' | 'ndjson' | 'csv' = 'json';
  let qSearch: string | null = null;
  let qin: string[] | null = null;
  let seedParam: string | null = null;

  const fields: FieldSpec[] = [];

  for (const [key, value] of params) {
    if (key.startsWith('_')) {
      switch (key) {
        case '_page':
          page = reqInt(key, value, 1, Number.MAX_SAFE_INTEGER);
          break;
        case '_limit':
          limit = Math.min(reqInt(key, value, 1, Number.MAX_SAFE_INTEGER), MAX_LIMIT); // 상한 강제
          break;
        case '_total':
          total = reqInt(key, value, 0, 1_000_000);
          break;
        case '_seed':
          seedParam = value;
          break;
        case '_locale':
          if (value !== 'ko' && value !== 'en' && value !== 'ja' && value !== 'zh') {
            fail('Invalid reserved parameter', key, value, "_locale 은 ko | en | ja | zh 입니다.");
          }
          locale = value;
          break;
        case '_delay':
          delay = Math.min(reqInt(key, value, 0, Number.MAX_SAFE_INTEGER), MAX_DELAY); // 상한 강제
          break;
        case '_status':
          status = reqInt(key, value, 100, 599);
          break;
        case '_wrap':
          if (value !== 'envelope' && value !== 'none') fail('Invalid reserved parameter', key, value, "_wrap 은 'envelope' 또는 'none' 입니다.");
          wrap = value;
          break;
        case '_format':
          if (value !== 'json' && value !== 'ndjson' && value !== 'csv') {
            fail('Invalid reserved parameter', key, value, "_format 은 'json' | 'ndjson' | 'csv' 입니다. ndjson/csv 는 아이템만 스트리밍합니다.");
          }
          format = value;
          break;
        case '_q': {
          const trimmed = value.trim();
          if (trimmed.length > 100) fail('Invalid reserved parameter', key, value, '_q 검색어는 최대 100자입니다.');
          if (trimmed !== '') qSearch = trimmed;
          break;
        }
        case '_qin': {
          const parts = value.split(',').map((s) => s.trim()).filter((s) => s !== '');
          if (parts.length > 0) qin = parts; // 필드 존재 검증은 필드 파싱 후에
          break;
        }
        default:
          fail(
            'Unknown reserved parameter',
            key,
            value,
            `'_' 로 시작하는 이름은 예약어입니다. 필드명은 '_' 없이 시작하세요. 예약어: ${RESERVED_NAMES.join(', ')}`,
          );
      }
      continue;
    }

    // 필드 정의
    if (!FIELD_NAME_RE.test(key)) {
      fail(
        'Invalid field name',
        key,
        value,
        "필드명은 영문으로 시작하고 [A-Za-z0-9_] 만 쓸 수 있습니다. 중첩은 'a.b', 배열은 'tags[]' 형태입니다.",
      );
    }
    if (value === '') {
      fail('Missing field type', key, value, `타입을 지정하세요. 예: ${key}=person.fullName 또는 ${key}=int:20~60`);
    }

    const isArray = key.endsWith('[]');
    const bare = isArray ? key.slice(0, -2) : key;
    const path = bare.split('.');
    if (path.length > 5) fail('Too deep nesting', key, value, '중첩은 최대 5단계까지 지원합니다.');

    let itemType = value;
    let arrayLen = 1;
    if (isArray) {
      const split = splitArrayLen(value);
      itemType = split.itemType;
      arrayLen = split.len;
    }

    let gen: Generator;
    try {
      gen = compileType(itemType);
    } catch (e) {
      if (e instanceof DslError) throw new DslError({ ...e.info, field: key, value });
      throw e;
    }

    fields.push({ name: key, path, isArray, arrayLen, typeRaw: value, gen });
  }

  if (fields.length === 0) {
    fail(
      'No fields defined',
      undefined,
      '',
      '필드를 하나 이상 정의하세요. 예: /api/users?name=person.fullName&age=int:20~60 — GUI: GET /',
    );
  }

  // 필드명 정렬 — 순서만 다른 URL 이 같은 결과를 내도록 정규화
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // 경로 충돌 검사 (a=int:1~5 와 a.b=uuid 동시 정의 등)
  checkPathConflicts(fields);

  // _qin 검증 — 존재하는 필드 경로(또는 그 상위 경로)만 허용. 오타를 조용히 무시하면
  // "왜 결과가 이상하지" 로 이어지므로 400 + 가용 목록으로 명시한다.
  if (qin !== null) {
    if (qSearch === null) {
      fail('Invalid reserved parameter', '_qin', qin.join(','), '_qin 은 _q(검색어) 와 함께 사용합니다. 예: _q=김&_qin=name');
    }
    const available = [...new Set(fields.map((f) => f.path.join('.')))];
    for (const p of qin) {
      const ok = available.some((a) => a === p || a.startsWith(p + '.'));
      if (!ok) {
        fail('Unknown search field', '_qin', p, `'${p}' 필드가 없습니다. 사용 가능: ${available.join(', ')}`);
      }
    }
  }

  // baseSeed 용 정규화 문자열 — _page/_limit/_delay/_status/_wrap 제외.
  // 기본값을 명시한 URL 과 생략한 URL 이 같은 시드를 갖도록 유효값 기준으로 만든다.
  const parts = [`_locale=${locale}`, `_total=${total}`];
  if (seedParam !== null) parts.push(`_seed=${seedParam}`);
  for (const f of fields) parts.push(`${f.name}=${f.typeRaw}`);
  const normalized = parts.join('&');

  return { page, limit, total, locale, delay, status, wrap, format, q: qSearch, qin, seedParam, fields, normalized };
}

function checkPathConflicts(fields: FieldSpec[]): void {
  const leaves = new Set<string>();
  for (const f of fields) {
    leaves.add(f.path.join('.'));
  }
  for (const f of fields) {
    // 어떤 필드의 리프가 다른 필드의 중간 경로면 충돌
    for (let i = 1; i < f.path.length; i++) {
      const prefix = f.path.slice(0, i).join('.');
      if (leaves.has(prefix)) {
        fail(
          'Field path conflict',
          f.name,
          f.typeRaw,
          `'${prefix}' 가 값이면서 동시에 '${f.name}' 의 상위 객체일 수 없습니다. 둘 중 하나를 바꾸세요.`,
        );
      }
    }
  }
}
