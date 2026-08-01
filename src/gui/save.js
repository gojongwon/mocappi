import { $, addRow, fieldsEl } from './dom.js';
import { LANG, t } from './i18n.js';
import { advActive, update } from './preview.js';
import { enc, encPath, parseAliasParam } from './pure.js';
import { shared } from './shared.js';
// buildQuery 는 url-state 의 래퍼 — 화면의 별칭 입력칸을 함께 읽는다 (pure 쪽은 별칭을 인자로 받음)
import { OPT_DEFAULTS, OPT_INPUTS, buildQuery, readState, setOptKeys } from './url-state.js';
import { syncWsUi } from './workspace.js';

// ---- 팀 스키마 저장/불러오기 ----
// KV 미설정이면: 저장 버튼은 보이되 클릭 시 활성화 안내, 팀 프리셋 목록만 숨김
let teamAvailable = false;
let teamItems = [];

// 모바일에선 프리셋 버튼을 숨기고 이 드롭다운 하나로 통합 (기본은 optgroup 구분)
const presetMql = window.matchMedia('(max-width: 640px)');

export function renderTeamOptions() {
  const sel = $('#teamSel');
  const mobile = presetMql.matches;
  sel.innerHTML = '<option value="">' + (mobile ? t('프리셋 선택…', 'Choose a preset…') : t('저장된 프리셋…', 'Saved presets…')) + '</option>';
  if (mobile) {
    const g = document.createElement('optgroup');
    g.label = t('기본 프리셋', 'Built-in presets');
    for (const [k, label] of [['users', t('사용자', 'Users')], ['products', t('상품', 'Products')], ['orders', t('주문 상세', 'Order detail')]]) {
      const o = document.createElement('option');
      o.value = 'preset:' + k;
      o.textContent = label;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  const parent = mobile && shared.ws ? (() => { const g = document.createElement('optgroup'); g.label = t('내 프리셋', 'My presets'); sel.appendChild(g); return g; })() : sel;
  if (shared.ws && teamItems.length === 0) {
    const o = document.createElement('option');
    o.disabled = true;
    o.textContent = t('아직 없음 — "프리셋으로 저장"으로 첫 항목을 만들어보세요', 'Nothing yet — use "Save as preset" to create the first one');
    parent.appendChild(o);
  }
  for (const it of teamItems) {
    const o = document.createElement('option');
    o.value = it.sid;
    o.textContent = it.name + ' (/api/' + it.res + ')';
    parent.appendChild(o);
  }
  if (shared.loadedPreset) sel.value = shared.loadedPreset.sid; // 목록 갱신 후에도 현재 프리셋 유지
}

/** 모바일이면 워크스페이스 없이도 드롭다운 노출 (기본 프리셋 접근 경로) */
export function syncTeamSelVisibility() {
  $('#teamSel').style.display = (shared.ws || presetMql.matches) ? '' : 'none';
}
if (presetMql.addEventListener) presetMql.addEventListener('change', () => { renderTeamOptions(); syncTeamSelVisibility(); });

export async function refreshTeam() {
  try {
    const res = await fetch('/schema/saved' + (shared.ws ? '?ws=' + shared.ws : ''), { headers: { 'Accept-Language': LANG } });
    if (!res.ok) return; // 501 = KV 미설정
    const body = await res.json();
    teamAvailable = true;
    $('#wsBtn').style.display = '';
    syncWsUi();
    teamItems = body.items;
    syncTeamSelVisibility();
    renderTeamOptions();
  } catch {}
}

export function applyQueryString(res, query) {
  $('#resource').value = res;
  fieldsEl.innerHTML = '';
  for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = OPT_DEFAULTS[k];
  const qp = new URLSearchParams(query);
  const { rev, byDef } = parseAliasParam(qp);
  setOptKeys(byDef);
  for (const [k, v] of qp) {
    if (k === '_alias') continue;
    const def = rev[k] || k;
    if (def in OPT_INPUTS) { $(OPT_INPUTS[def]).value = v; continue; }
    if (k.startsWith('_')) continue;
    addRow(k, v);
  }
  if (!fieldsEl.children.length) addRow();
  $('#optsAdv').open = advActive();
  update();
}

// 현재 불러온/저장한 프리셋 — 짧은 URL 표시의 근거


export async function loadTeamPreset(sid) {
  try {
    const res = await fetch('/schema/saved/' + sid, { headers: { 'Accept-Language': LANG } });
    if (!res.ok) return;
    const rec = await res.json();
    if (!shared.loadedPreset) {
      const s = readState();
      shared.preloadSnapshot = { res: s.res, query: buildQuery(s) };
    }
    shared.loadedPreset = { sid: rec.sid, res: rec.res, query: rec.query, name: rec.name };
    applyQueryString(rec.res, rec.query);
  } catch {}
}

/** '저장된 프리셋…'(빈 값) 선택 = 해제 → 선택 전 편집 상태로 복원 */
export function unloadTeamPreset() {
  if (!shared.loadedPreset) return;
  shared.loadedPreset = null;
  const snap = shared.preloadSnapshot; // 초기화보다 먼저 읽는다
  shared.preloadSnapshot = null;
  $('#teamSel').classList.remove('active');
  if (snap) applyQueryString(snap.res, snap.query);
  else update();
}

/**
 * 짧은 URL 계산 — 저장본과 현재 상태를 비교해:
 * 예약 옵션/필드 값 변경·추가는 _s 뒤 오버라이드로 표현,
 * 저장본 필드의 삭제·이름변경은 표현 불가 → null (숨김)
 */
export function shortApiUrl(state) {
  if (!shared.loadedPreset) return null;
  const saved = new URLSearchParams(shared.loadedPreset.query);
  const cur = new URLSearchParams(buildQuery(state));
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

export function openSave() {
  $('#saveError').textContent = '';
  $('#saveResult').style.display = 'none';
  const kvReady = teamAvailable;
  const wsReady = kvReady && !!shared.ws; // 저장은 워크스페이스 전용
  $('#saveSetup').style.display = kvReady ? 'none' : 'block';
  $('#saveWsRequired').style.display = kvReady && !shared.ws ? 'block' : 'none';
  $('#saveName').style.display = wsReady ? '' : 'none';
  $('#saveApply').style.display = wsReady ? '' : 'none';
  $('#saveModal').style.display = 'flex';
  if (wsReady) $('#saveName').focus();
}

export async function applySave() {
  const name = $('#saveName').value.trim();
  if (!name) { $('#saveError').textContent = t('이름을 입력하세요.', 'Enter a name.'); return; }
  const state = readState();
  try {
    const res = await fetch('/schema/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Accept-Language': LANG },
      body: JSON.stringify({ name, res: state.res, query: buildQuery(state), ws: shared.ws || undefined }),
    });
    const body = await res.json();
    if (!res.ok) {
      $('#saveError').textContent = (res.status === 429 || res.status === 503)
        ? (body.hint || t('지금은 저장할 수 없습니다. 잠시 후 다시 시도하세요.', 'Cannot save right now. Try again shortly.'))
        : (body.error || t('저장 실패', 'Save failed')) + (body.hint ? ' — ' + body.hint : '');
      return;
    }
    $('#saveError').textContent = '';
    const shortUrl = location.origin + body.apiUrl;
    $('#shortUrlBox').textContent = shortUrl;
    $('#shortUrlBox').dataset.url = shortUrl;
    // 저장 완료 상태로 전환 — 입력칸과 저장 버튼은 치우고 결과만
    $('#saveName').style.display = 'none';
    $('#saveApply').style.display = 'none';
    $('#saveResult').style.display = 'block';
    shared.loadedPreset = { sid: body.sid, res: body.res, query: body.query, name: body.name }; // 이후 URL 박스에도 짧은 URL 상시 표시
    refreshTeam();
    update();
  } catch (e) {
    $('#saveError').textContent = t('요청 실패: ', 'Request failed: ') + e;
  }
}

