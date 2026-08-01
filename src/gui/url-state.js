import { $, addRow, emit, fieldsEl } from './dom.js';
import { buildQuery as buildQueryPure, enc, encPath, parseAliasParam } from './pure.js';
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
    const v = String($(sel).value).trim();
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

