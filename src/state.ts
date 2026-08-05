/**
 * 프리셋 상태 — 워크스페이스 프리셋(_s=<ws>.<id>) 한정 쓰기 오버레이.
 *
 * TanStack Query 류의 "mutation → invalidate → refetch" 흐름이 실제로 동작하려면
 * 쓰기가 다음 GET 에 보여야 한다. 그래서 저장된 프리셋으로 호출할 때만:
 *   POST(JSON 바디)      → 생성 — 목록 맨 앞에 나타나고 total 이 는다
 *   PUT/PATCH /경로/<id> → 수정 — 해당 아이템에 바디가 얕게 병합돼 보인다
 *   DELETE   /경로/<id>  → 삭제 — 목록에서 사라지고 total 이 준다
 *
 * 결정성 약속과의 경계: 상태는 "기본 데이터 위에 얹는 오버레이"다. 시드·기본
 * 아이템은 그대로고, 순수 쿼리 URL 과 공용 풀 프리셋은 이 파일을 아예 안 탄다.
 * 워크스페이스는 이미 "링크 아는 사람끼리"의 capability 모델이라, 상태의 소유
 * 단위로 그대로 쓴다 — 새 개념·새 파라미터 없음.
 *
 * 오버레이는 검색·정렬과 같은 앞 1,000개 창(SEARCH_SCAN_MAX) 안에서 동작하고,
 * 레코드 하나(st:<ws>:<id>)로 저장된다 — 쓰기 1회 = 저장소 쓰기 1회. TTL 24시간.
 *
 * GUI 미리보기가 상태를 오염시키지 않는 이유: 미리보기는 바디 없는 요청을 보내고,
 * POST/PUT/PATCH 는 JSON 바디가 있을 때만, DELETE 는 경로에 id 가 있을 때만 쓴다.
 */
import type { FieldSpec, ParsedQuery } from './dsl';
import { baseSeedOf, generateItem, windowItems } from './generate';
import { DslError, NULLABLE_RE, uuidFromSeed } from './registry';
import { hashString } from './rng';
import { parseSid } from './store';

export interface StateRecord {
  v: 1;
  /** 생성 순번 — 새 아이템의 기본값 시드(총원 + seq)와 합성 id 파생에 쓴다 */
  seq: number;
  /** 생성된 아이템 — 최신 먼저. 쓰기 시점에 완성된 객체로 저장한다 */
  created: Array<Record<string, unknown>>;
  /** PATCH: id 값(문자열화) → 얕은 패치 (최상위 키 병합) */
  updated: Record<string, Record<string, unknown>>;
  /** PUT: id 값(문자열화) → 교체 바디 — 안 보낸 필드는 사라진다 (id 는 유지) */
  replaced: Record<string, Record<string, unknown>>;
  /** 삭제된 기본 아이템의 id 값(문자열화) */
  deleted: string[];
}

export const STATE_TTL_SECONDS = 60 * 60 * 24; // 24시간 — 쓰기마다 갱신. 시연용 임시 상태다
export const MAX_CREATED = 50;
export const MAX_UPDATED = 100;
export const MAX_DELETED = 200;
const MAX_BODY_JSON = 4000;

export const emptyState = (): StateRecord => ({ v: 1, seq: 0, created: [], updated: {}, replaced: {}, deleted: [] });

export const hasState = (rec: StateRecord): boolean =>
  rec.created.length > 0 || rec.deleted.length > 0 ||
  Object.keys(rec.updated).length > 0 || Object.keys(rec.replaced).length > 0;

/** 상태 저장 키 — 워크스페이스 프리셋만 상태를 가진다. 아니면 null */
export function stateKeyOf(sid: string): string | null {
  const parsed = parseSid(sid);
  return parsed && parsed.ws ? `st:${parsed.ws}:${parsed.id}` : null;
}

function fail(error: string, hint: string, hintEn: string): never {
  throw new DslError({ error, hint, hintEn });
}

/** 스키마의 정체성 필드 — 최상위 'id'. 수정/삭제 대상 매칭의 기준 */
export function idFieldOf(q: ParsedQuery): boolean {
  return q.fields.some((f) => !f.isArray && f.path.length === 1 && f.path[0] === 'id');
}

const idOf = (item: Record<string, unknown>): string | null =>
  item.id === undefined || item.id === null ? null : String(item.id);

/** 기본 아이템에 교체(PUT)·패치(PATCH)를 순서대로 적용 — PUT 이 바닥, PATCH 가 그 위 */
function composed(item: Record<string, unknown>, key: string | null, rec: StateRecord): Record<string, unknown> {
  if (key === null) return item;
  const rep = rec.replaced[key];
  const up = rec.updated[key];
  if (!rep && !up) return item;
  const base = rep ? { ...rep, id: item.id } : item; // PUT: 안 보낸 필드는 사라진다 — 정체성(id)만 지킨다
  return up ? { ...base, ...up } : { ...base };
}

/** 오버레이 적용된 창 — [생성(최신 먼저)] ++ [기본 창 − 삭제, 교체·수정 반영] */
export function mergedWindow(q: ParsedQuery, rec: StateRecord): Record<string, unknown>[] {
  const base = windowItems(q);
  const deleted = new Set(rec.deleted);
  const out: Record<string, unknown>[] = [...rec.created];
  for (const item of base) {
    const key = idOf(item);
    if (key !== null && deleted.has(key)) continue;
    out.push(composed(item, key, rec));
  }
  return out;
}

/** _wrap=one 상세 — 경로 id 가 생성/수정/기본 창의 아이템과 맞으면 그 아이템 */
export function findById(q: ParsedQuery, rec: StateRecord, id: string): Record<string, unknown> | null {
  for (const c of rec.created) if (idOf(c) === id) return c;
  if (!idFieldOf(q)) return null;
  for (const item of windowItems(q)) {
    if (idOf(item) !== id) continue;
    if (rec.deleted.includes(id)) return null; // 삭제된 아이템의 상세도 없어야 진짜다
    return composed(item, id, rec);
  }
  return null;
}

export interface WriteOutcome {
  status: number;
  body: unknown;
  /** 레코드가 바뀌었는가 — true 면 호출부가 저장한다 */
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// 바디 검증 — 타입까지만, 값은 안 본다.
//
// 스키마는 "어떻게 생성할지"의 명세라 값 규칙(int:20~60 의 범위, enum 멤버)을
// 검증으로 승격하면 정당한 테스트(age=15 미성년 분기 등)가 막힌다. 반면 타입이
// 어긋난 아이템이 목록에 섞이면 /schema/ts 로 뽑은 타입이 거짓말을 하게 되므로
// JS 타입 수준은 지킨다. 스키마에 없는 필드는 요청 DTO 전용(password 등)으로
// 보고 entity 에서 조용히 제외한다 — 실제 API 가 응답에 안 싣는 것과 같다.
// ---------------------------------------------------------------------------

const typeName = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** 필드의 기대 JS 타입 — 생성기를 실제로 돌려 본다 (openapi.ts 의 probe 와 같은 수법) */
function probeType(f: FieldSpec, q: ParsedQuery): string {
  for (const seed of [12345, 777, 20260805]) {
    const v = f.gen(seed, { globalIndex: 0, locale: q.locale });
    if (v !== null && v !== undefined) return typeof v;
  }
  return 'string'; // 전부 null 이면(극단적 nullable) 문자열로 간주 — 어차피 null 은 항상 통과
}

function typeFail(path: string, expected: string, got: string): never {
  const formHint = (expected === 'number' || expected === 'boolean') && got === 'string';
  throw new DslError({
    error: 'Type mismatch',
    field: path,
    value: got,
    hint: `'${path}' 는 ${expected} 필드인데 ${got} 을 보냈습니다.` +
      (formHint ? ' 폼 입력값(항상 문자열)이 변환 없이 들어가지 않았는지 확인하세요.' : ''),
    hintEn: `'${path}' is a ${expected} field but you sent ${got}.` +
      (formHint ? ' Check that a form input value (always a string) did not go in unconverted.' : ''),
  });
}

/** 바디를 스키마 타입으로 검증하고, 스키마에 없는 필드는 걸러낸 사본을 돌려준다 */
function validateBody(q: ParsedQuery, body: Record<string, unknown>): Record<string, unknown> {
  const leaves = new Map<string, FieldSpec>();
  const parents = new Set<string>();
  for (const f of q.fields) {
    leaves.set(f.path.join('.'), f);
    for (let i = 1; i < f.path.length; i++) parents.add(f.path.slice(0, i).join('.'));
  }

  function walk(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const f = leaves.get(path);
      if (f) {
        if (v === null) { out[k] = null; continue; } // null 은 항상 허용 — nullable 여부는 생성 규칙이다
        if (f.isArray) {
          if (!Array.isArray(v)) typeFail(path, 'array', typeName(v));
          const et = probeType(f, q);
          for (const el of v) if (el !== null && typeof el !== et) typeFail(`${path}[]`, et, typeName(el));
          out[k] = v;
        } else {
          const et = probeType(f, q);
          if (typeName(v) !== et) typeFail(path, et, typeName(v));
          out[k] = v;
        }
        continue;
      }
      if (parents.has(path)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) typeFail(path, 'object', typeName(v));
        out[k] = walk(v as Record<string, unknown>, path);
        continue;
      }
      // 스키마에 없는 필드 — 요청 전용(password 등)으로 보고 entity 에 싣지 않는다
    }
    return out;
  }
  return walk(body, '');
}

/**
 * PUT 완전성 검사 — PUT 은 "리소스의 완전한 표현"이다.
 * id(경로에서 온다)를 뺀 전 필드가 있어야 하고, 빠지면 어떤 필드가 빠졌는지와
 * "부분 수정은 PATCH" 를 함께 알려준다 — PUT/PATCH 의 차이를 에러가 가르친다.
 * nullable(?) 필드만 생략 가능: 생략 = null 로 저장한다. 그래서 PUT 뒤에도
 * 아이템 모양이 항상 스키마와 정확히 일치한다 (필드가 "사라지는" 일이 없다).
 */
function completeForPut(q: ParsedQuery, body: Record<string, unknown>): Record<string, unknown> {
  const missing: string[] = [];
  for (const f of q.fields) {
    if (f.path.length === 1 && f.path[0] === 'id') continue;
    let cur: unknown = body;
    let present = true;
    for (const seg of f.path) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur) || (cur as Record<string, unknown>)[seg] === undefined) {
        present = false;
        break;
      }
      cur = (cur as Record<string, unknown>)[seg];
    }
    if (present) continue;
    if (!f.isArray && NULLABLE_RE.test(f.typeRaw)) {
      // 생략된 nullable → null — "없음"의 완전한 표현
      let obj = body;
      for (let i = 0; i < f.path.length - 1; i++) {
        obj = (obj[f.path[i]] ??= {}) as Record<string, unknown>;
      }
      obj[f.path[f.path.length - 1]] = null;
    } else {
      missing.push(f.name);
    }
  }
  if (missing.length > 0) {
    throw new DslError({
      error: 'Missing fields',
      field: missing.join(', '),
      hint: `PUT 은 리소스의 완전한 표현을 보냅니다 — 빠진 필드: ${missing.join(', ')}. 일부만 바꾸려면 PATCH 를 쓰세요.`,
      hintEn: `PUT sends the complete representation of the resource — missing fields: ${missing.join(', ')}. To change only some fields, use PATCH.`,
    });
  }
  return body;
}

/** 쓰기 바디 검증 — JSON 객체 + 크기 상한 */
function checkBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('Invalid state body',
      '상태를 바꾸는 쓰기의 바디는 JSON 객체여야 합니다. 예: {"name": "홍길동"}',
      'The body of a stateful write must be a JSON object, e.g. {"name": "Hong Gildong"}');
  }
  if (JSON.stringify(body).length > MAX_BODY_JSON) {
    fail('Invalid state body',
      `바디는 JSON 기준 최대 ${MAX_BODY_JSON}자입니다.`,
      `The body is limited to ${MAX_BODY_JSON} characters of JSON.`);
  }
  return body as Record<string, unknown>;
}

const notFound = (id: string, lang: 'ko' | 'en') => ({
  status: 404,
  body: {
    error: 'Not Found',
    status: 404,
    message: lang === 'en'
      ? `No item with id '${id}' in the first 1,000 items or the created ones.`
      : `앞 1,000개 창과 생성된 아이템 중에 id '${id}' 가 없습니다.`,
  },
  dirty: false,
});

/**
 * 쓰기 한 건 적용. rec 을 제자리에서 수정하고 결과 응답을 돌려준다.
 * 호출 조건(라우터가 보장): 워크스페이스 프리셋 + (POST/PUT/PATCH 는 JSON 바디,
 * DELETE 는 경로 id) — 조건 미달이면 이 함수에 오지 않고 기존 무상태 응답이 나간다.
 */
export function applyWrite(
  q: ParsedQuery,
  rec: StateRecord,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  pathId: string | null,
  rawBody: unknown,
  sid: string,
  lang: 'ko' | 'en',
): WriteOutcome {
  if (method === 'DELETE') {
    const id = pathId as string;
    const ci = rec.created.findIndex((c) => idOf(c) === id);
    if (ci !== -1) {
      rec.created.splice(ci, 1);
      delete rec.updated[id];
      delete rec.replaced[id];
      return { status: 204, body: null, dirty: true };
    }
    if (!idFieldOf(q) || rec.deleted.includes(id)) return notFound(id, lang);
    if (!windowItems(q).some((item) => idOf(item) === id)) return notFound(id, lang);
    if (rec.deleted.length >= MAX_DELETED) {
      fail('State full',
        `삭제는 프리셋당 최대 ${MAX_DELETED}건입니다. DELETE /schema/state/${sid} 로 상태를 초기화하세요.`,
        `Deletions are limited to ${MAX_DELETED} per preset. Reset the state via DELETE /schema/state/${sid}.`);
    }
    rec.deleted.push(id);
    delete rec.updated[id];
    delete rec.replaced[id];
    return { status: 204, body: null, dirty: true };
  }

  const body = validateBody(q, checkBody(rawBody));
  // POST 는 부분 허용 — 안 보낸 필드는 서버(목)가 채운다: 실제 API 의 기본값·생성 동작.
  // PUT 은 완전한 표현을 요구한다 — 그래서 교체 뒤에도 모양이 스키마와 일치한다
  if (method === 'PUT') completeForPut(q, body);

  if (method === 'POST') {
    if (rec.created.length >= MAX_CREATED) {
      fail('State full',
        `생성은 프리셋당 최대 ${MAX_CREATED}건입니다. DELETE /schema/state/${sid} 로 상태를 초기화하세요.`,
        `Creations are limited to ${MAX_CREATED} per preset. Reset the state via DELETE /schema/state/${sid}.`);
    }
    // 기본값은 "총원 다음 인덱스"의 가상 아이템 — 스키마 모양 그대로, 결정적.
    // 그 위에 바디를 얕게 덮는다: 보낸 값은 그대로, 안 보낸 필드는 그럴듯한 기본값.
    const item = { ...generateItem(baseSeedOf(q), q.total + rec.seq, q), ...body };
    // 정체성 보장 — 스키마에 id 필드가 없어도 생성물은 수정/삭제할 수 있어야 한다
    if (item.id === undefined || item.id === null) {
      item.id = uuidFromSeed(hashString(`state:${sid}:${rec.seq}`));
    }
    const newId = idOf(item) as string;
    if (rec.created.some((c) => idOf(c) === newId)) {
      fail('Duplicate id',
        `id '${newId}' 로 이미 생성한 아이템이 있습니다.`,
        `An item with id '${newId}' has already been created.`);
    }
    rec.seq++;
    rec.created.unshift(item);
    return { status: 201, body: item, dirty: true };
  }

  // PUT / PATCH — 대상 id: 경로 세그먼트가 우선, 없으면 바디의 id
  const id = pathId ?? (body.id === undefined || body.id === null ? null : String(body.id));
  if (id === null) {
    fail('Missing item id',
      `수정 대상 id 가 필요합니다 — 경로로 지정하세요. 예: ${method} /api/<리소스>/<id>`,
      `An item id is required — put it in the path, e.g. ${method} /api/<resource>/<id>`);
  }
  const { id: _drop, ...patch } = body; // id 자체는 바꿀 수 없다 — 정체성이 흔들리면 매칭이 깨진다

  // PUT 은 교체, PATCH 는 병합 — 실제 REST 의미 그대로. 목이 의미를 뭉개면
  // "왜 PUT 인데 나머지 필드가 남지?" 같은 실서비스 착각을 학습시킨다
  const created = rec.created.find((c) => idOf(c) === id);
  if (created) {
    if (method === 'PUT') {
      for (const k of Object.keys(created)) if (k !== 'id') delete created[k];
    }
    Object.assign(created, patch);
    return { status: 200, body: created, dirty: true };
  }
  if (!idFieldOf(q)) {
    fail('No id field',
      "기본 아이템을 수정하려면 스키마에 최상위 'id' 필드가 필요합니다 (생성한 아이템은 id 필드 없이도 수정됩니다).",
      "Editing base items requires a top-level 'id' field in the schema (created items are editable without one).");
  }
  if (rec.deleted.includes(id)) return notFound(id, lang);
  const target = windowItems(q).find((item) => idOf(item) === id);
  if (!target) return notFound(id, lang);
  const touched = rec.updated[id] !== undefined || rec.replaced[id] !== undefined;
  if (!touched && Object.keys(rec.updated).length + Object.keys(rec.replaced).length >= MAX_UPDATED) {
    fail('State full',
      `수정은 프리셋당 최대 ${MAX_UPDATED}건입니다. DELETE /schema/state/${sid} 로 상태를 초기화하세요.`,
      `Updates are limited to ${MAX_UPDATED} per preset. Reset the state via DELETE /schema/state/${sid}.`);
  }
  if (method === 'PUT') {
    rec.replaced[id] = patch;
    delete rec.updated[id]; // 교체는 리셋이다 — 이전 패치가 남으면 교체가 아니다
  } else {
    rec.updated[id] = { ...rec.updated[id], ...patch };
  }
  return { status: 200, body: composed(target, id, rec), dirty: true };
}

/** 저장 레코드 역직렬화 — 손상·구버전이면 빈 상태로 (상태는 임시 데이터라 복구보다 리셋) */
export function parseState(raw: string | null): StateRecord {
  if (raw === null) return emptyState();
  try {
    const rec = JSON.parse(raw) as StateRecord;
    if (rec && rec.v === 1 && Array.isArray(rec.created) && Array.isArray(rec.deleted) && rec.updated) {
      rec.replaced ??= {}; // replaced 도입(v1.1.6) 이전 레코드 호환
      return rec;
    }
  } catch { /* fall through */ }
  return emptyState();
}
