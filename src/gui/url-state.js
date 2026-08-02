import { $, addRow, emit, fieldsEl } from './dom.js';
import { t } from './i18n.js';
import { buildQuery as buildQueryPure, enc, encPath, highlightJson, minifyJson, parseAliasParam, prettyJson } from './pure.js';
import { shared } from './shared.js';

export const OPT_DEFAULTS = { _total: '100', _limit: '10', _page: '1', _locale: 'ko', _delay: '0', _status: '200', _method: 'get', _body: '', _q: '', _qin: '', _wrap: 'envelope', _seed: '', _format: 'json' };
export const OPT_INPUTS = { _total: '#oTotal', _limit: '#oLimit', _page: '#oPage', _locale: '#oLocale', _delay: '#oDelay', _status: '#oStatus', _method: '#oMethod', _body: '#oBody', _q: '#oQ', _qin: '#oQin', _wrap: '#oWrap', _seed: '#oSeed', _format: '#oFormat' };

// ---- 옵션 키 별칭 (인라인 편집 → _alias 자동 조립) ----
const ALIAS_OK_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** 기본값과 다르고 유효한 키만 { 예약어: 별칭 } 으로. 유효하지 않으면 .bad 표시 후 무시 */
function optAliases() {
  const map = {};
  for (const el of document.querySelectorAll('.okey')) {
    const def = el.dataset.for;
    const v = el.value.trim();
    const valid = v === def || ALIAS_OK_RE.test(v);
    el.classList.toggle('bad', !valid);
    if (valid && v !== def && v !== '') map[def] = v;
  }
  return map;
}

/** { 예약어: 별칭 } 적용 — 없는 키는 기본값으로 복원 */
export function setOptKeys(byDef) {
  for (const el of document.querySelectorAll('.okey')) {
    el.value = (byDef && byDef[el.dataset.for]) || el.dataset.for;
    el.classList.remove('bad');
  }
}

// 프리셋 3종 — 기능 쇼케이스를 겸한다:
//  users:    목록 + nullable(?p) + 가중치 enum + 중첩 객체
//  products: pattern 코드 + 배열 + float + nullable 긴 글
//  orders:   상세 엔드포인트 — 다단계 경로 + _wrap=one + _seed
export const PRESETS = {
  users: {
    res: 'users',
    fields: [
      ['id', 'uuid'], ['name', 'person.fullName'], ['email', 'internet.email?0.1'],
      ['tel', 'phone.number'], ['role', 'enum:admin*1|member*8|guest*3'],
      ['active', 'bool:0.85'], ['avatar', 'image:80x80'],
      ['address.city', 'location.city'], ['address.street', 'location.streetAddress'],
      ['joinedAt', 'date:2023-01-01~2026-07-01'],
    ],
    opts: { _total: '500', _limit: '20' },
  },
  products: {
    res: 'products',
    fields: [
      ['id', 'index'], ['sku', 'pattern:PRD-####-??'], ['name', 'commerce.productName'],
      ['price', 'int:1000~99000'], ['discountRate', 'float:0~0.5:2'],
      ['stock', 'int:0~500'], ['status', 'enum:sale*7|soldout*2|hidden*1'],
      ['tags[]', 'commerce.department:2'], ['images[]', 'image:300x300:3'],
      ['description', 'text:80?0.2'],
    ],
    opts: { _total: '300', _limit: '20' },
  },
  orders: {
    res: 'orders/1024',
    fields: [
      ['orderNo', 'pattern:ORD-2026-######'], ['status', 'enum:paid*5|shipped*3|delivered*4|cancelled*1'],
      ['amount', 'int:9000~450000'], ['paidAt', 'date:2026-01-01~2026-07-29'],
      ['customer.name', 'person.fullName'], ['customer.tel', 'phone.number'],
      ['customer.email', 'internet.email'],
      ['shipping.city', 'location.city'], ['shipping.street', 'location.streetAddress'],
      ['items[]', 'commerce.productName:3'], ['memo', 'text:40?0.3'],
    ],
    opts: { _wrap: 'one', _seed: '1024' },
  },
};

export function readState() {
  const fields = [];
  for (const row of fieldsEl.querySelectorAll('.frow')) {
    const n = row.querySelector('.fname').value.trim();
    const v = row.querySelector('.fval').value.trim();
    if (n && v) fields.push([n, v]);
  }
  const opts = {};
  for (const [k, sel] of Object.entries(OPT_INPUTS)) {
    let v = String($(sel).value).trim();
    if (k === '_body') v = minifyJson(v); // 입력칸은 정렬형, URL 은 압축형
    if (v !== '' && v !== OPT_DEFAULTS[k]) opts[k] = v;
  }
  return { res: $('#resource').value.trim() || 'items', fields, opts };
}

/** 화면의 별칭 입력칸을 읽어 순수 buildQuery 에 넘기는 래퍼 — 호출부는 별칭을 몰라도 된다 */
export const buildQuery = (state) => buildQueryPure(state, optAliases());

/**
 * API URL 은 메서드 중립이다 — 메서드는 쿼리가 아니라 실제 요청 verb 로 간다.
 * (_method 는 손으로 URL 을 쓸 때를 위해 서버에 남아 있지만 GUI 는 쓰지 않는다)
 * 주소창(syncAddressBar)에는 계속 실린다 — 그쪽은 GUI 상태이지 API 호출이 아니라서.
 */
const apiState = (s) => { const { _method, ...opts } = s.opts; return { ...s, opts }; };
export const apiQuery = (state) => buildQuery(apiState(state));

export function apiUrl(state) {
  return location.origin + '/api/' + encPath(state.res) + '?' + apiQuery(state);
}

/**
 * 짧은 URL 계산 — 저장본과 현재 상태를 비교해:
 * 예약 옵션/필드 값 변경·추가는 _s 뒤 오버라이드로 표현,
 * 저장본 필드의 삭제·이름변경은 표현 불가 → null (숨김)
 */
export function shortApiUrl(state) {
  if (!shared.loadedPreset) return null;
  const saved = new URLSearchParams(shared.loadedPreset.query);
  const cur = new URLSearchParams(apiQuery(state));
  for (const [k] of saved) {
    if (!k.startsWith('_') && !cur.has(k)) return null; // 필드 삭제됨
  }
  const overrides = [];
  for (const [k, v] of cur) {
    if (saved.get(k) !== v) overrides.push(enc(k) + '=' + enc(v));
  }
  for (const k of Object.keys(OPT_DEFAULTS)) {
    if (saved.has(k) && !cur.has(k)) overrides.push(k + '=' + OPT_DEFAULTS[k]); // 기본값으로 되돌림도 명시
  }
  return location.origin + '/api/' + encPath(state.res) +
    '?_s=' + shared.loadedPreset.sid + (overrides.length ? '&' + overrides.join('&') : '');
}

/** 고급 옵션 중 하나라도 기본값이 아닌가 — 이 값들의 입력칸을 OPT_INPUTS 가 들고 있어 여기가 제자리 */
export function advActive() {
  return $('#oDelay').value !== '0' || $('#oStatus').value !== '200' ||
    $('#oBody').value.trim() !== '' ||
    $('#oWrap').value !== 'envelope' || $('#oSeed').value.trim() !== '' ||
    $('#oFormat').value !== 'json';
}

/** 메서드 선택 — 숨은 #oMethod 가 실제 상태, 버튼은 표시일 뿐 (OPT_INPUTS 가 .value 를 요구) */
export function setMethod(m) {
  $('#oMethod').value = m;
  emit('schema:changed'); // 하이라이트는 구독자(preview.update)가 paintMethod 로 맞춘다
}

/** #oMethod 값에 맞춰 버튼 하이라이트. 상태를 복원하는 곳이 4군데라 schema:changed 한 곳에서만 부른다 */
export function paintMethod() {
  const cur = $('#oMethod').value;
  for (const b of document.querySelectorAll('.methods button')) b.classList.toggle('on', b.dataset.method === cur);
}

// 빈 칸일 때 미리 보여줄 기본 실패 응답. paintBody 가 갱신하고 Tab(acceptGhost)이 소비한다.
// 서버의 FAIL_REASONS(코드 10종 × ko/en)를 GUI 에 복사하지 않으려고, 미리보기가 방금 받아둔
// 응답을 그대로 쓴다 — 상태코드·언어에 자동으로 맞고 사본이 안 생긴다.
let ghost = null;

function ghostBody() {
  const status = Number($('#oStatus').value);
  if (status < 400) return null; // 미리보기가 성공 데이터다
  const g = prettyJson(shared.lastPreviewText); // 요청이 실패했으면 String(e) → null
  if (g === null) return null;
  // 기본 실패 바디는 자기 상태코드를 담고 있다. 안 맞으면 아직 이전 응답이 남아 있는 것 —
  // 미리보기가 300ms 디바운스라 _status 를 막 바꾼 직후가 그렇다. 그때는 안 보여준다.
  try { if (JSON.parse(g).status !== status) return null; } catch { return null; }
  return g;
}

/** 고스트를 실제 값으로 확정. 고스트가 없으면 false — 호출부가 Tab 을 그대로 흘려보낸다 */
export function acceptGhost() {
  if (ghost === null) return false;
  $('#oBody').value = ghost;
  emit('schema:changed');
  return true;
}

/** 실패 바디를 화면용으로 정렬. 깨진 JSON 이면 손대지 않고 false — 호출부가 오류를 알린다 */
export function formatBody() {
  const ta = $('#oBody');
  const out = prettyJson(ta.value);
  if (out === null) return false;
  ta.value = out;
  return true;
}

/**
 * 실패 바디 정렬 + 오버레이 하이라이트.
 * 자동 정렬은 포커스가 없을 때만 — 타이핑 중에 값을 갈아끼우면 캐럿이 끝으로 튄다.
 * 그래서 blur 로는 정렬이 안 걸리고, 손으로 친 JSON 은 '{ } 정렬' 버튼이 담당한다.
 * highlightJson 이 & < > 를 이스케이프하므로 innerHTML 로 안전하다.
 */
export function paintBody() {
  const ta = $('#oBody');
  const hl = $('#oBodyHl');
  if (document.activeElement !== ta) formatBody();
  // 빈 칸이면 오버레이가 안내를 통째로 맡는다 — placeholder 를 같이 쓰면 두 겹으로 겹친다
  const empty = ta.value === '';
  ghost = empty ? ghostBody() : null;
  const shown = empty
    ? (ghost ?? t('상태코드를 400 이상으로 두면 기본 실패 응답이 여기 미리 보입니다',
                  'Set the status to 400+ and the default failure response previews here'))
    : ta.value;
  hl.classList.toggle('ghost', empty);
  hl.innerHTML = highlightJson(shown) + '\n'; // pre 가 끝 줄바꿈을 삼키는 것 보정
  $('#oBodyHint').hidden = ghost === null;
  // 내용만큼 자라게 — 짧을 땐 스크롤바가 아예 안 생겨 두 겹이 확실히 맞는다 (상한은 CSS max-height).
  // 고스트는 textarea 가 비어 있어도 여러 줄이라 pre 쪽 높이도 같이 본다
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, hl.scrollHeight) + 'px';
}

// ---- GUI 상태 ↔ 주소창 (현재 URL 이 곧 GUI 상태) ----
export function syncAddressBar(state) {
  const q = (shared.ws ? '_ws=' + shared.ws + '&' : '') +
    '_res=' + enc(state.res) + (state.fields.length || Object.keys(state.opts).length ? '&' + buildQuery(state) : '');
  history.replaceState(null, '', '/?' + q + location.hash); // 해시(#en/#ko 언어 상태)는 보존
}

export function loadFromAddressBar() {
  const params = new URLSearchParams(location.search);
  if (![...params.keys()].length || !params.has('_res')) return false;
  $('#resource').value = params.get('_res') || 'items';
  fieldsEl.innerHTML = '';
  const { rev, byDef } = parseAliasParam(params);
  setOptKeys(byDef);
  for (const [k, v] of params) {
    if (k === '_res' || k === '_alias') continue;
    const def = rev[k] || k;
    if (def in OPT_INPUTS) { $(OPT_INPUTS[def]).value = v; continue; }
    if (k.startsWith('_')) continue;
    addRow(k, v);
  }
  if (!fieldsEl.children.length) addRow();
  $('#optsAdv').open = advActive();
  return true;
}

export function applyPreset(name) {
  shared.loadedPreset = null; shared.preloadSnapshot = null; // 내장 프리셋은 저장본과 무관
  const p = PRESETS[name];
  $('#resource').value = p.res;
  fieldsEl.innerHTML = '';
  for (const [n, v] of p.fields) addRow(n, v);
  setOptKeys(null); // 내장 프리셋은 기본 키 사용
  for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = (p.opts && p.opts[k]) || OPT_DEFAULTS[k];
  $('#optsAdv').open = advActive();
  emit('schema:changed');
}

