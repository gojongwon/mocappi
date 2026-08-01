import { $, addRow, fieldsEl } from './dom.js';
import { advActive, update } from './preview.js';
import { buildQuery as buildQueryPure, enc, encPath, parseAliasParam } from './pure.js';
import { shared } from './shared.js';

export const OPT_DEFAULTS = { _total: '100', _limit: '10', _page: '1', _locale: 'ko', _delay: '0', _status: '200', _q: '', _qin: '', _wrap: 'envelope', _seed: '', _format: 'json' };
export const OPT_INPUTS = { _total: '#oTotal', _limit: '#oLimit', _page: '#oPage', _locale: '#oLocale', _delay: '#oDelay', _status: '#oStatus', _q: '#oQ', _qin: '#oQin', _wrap: '#oWrap', _seed: '#oSeed', _format: '#oFormat' };

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

export function apiUrl(state) {
  return location.origin + '/api/' + encPath(state.res) + '?' + buildQuery(state);
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
  update();
}

