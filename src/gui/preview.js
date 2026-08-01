import { $ } from './dom.js';
import { LANG, t } from './i18n.js';
import { highlightJson } from './pure.js';
import { renderCsv, renderNdjson } from './render.js';
import { shortApiUrl } from './save.js';
import { shared } from './shared.js';
import { apiUrl, readState, syncAddressBar } from './url-state.js';

// ---- 미리보기 (디바운스 300ms) ----
let timer = null; let reqSeq = 0;
/** 고급 옵션 중 하나라도 기본값이 아닌가 */
export function advActive() {
  return $('#oDelay').value !== '0' || $('#oStatus').value !== '200' ||
    $('#oWrap').value !== 'envelope' || $('#oSeed').value.trim() !== '' ||
    $('#oFormat').value !== 'json';
}

export function update() {
  const state = readState();
  // 입력 중에는 절대 닫지 않는다 — 자동으로는 열기만.
  // (닫힘은 프리셋 전환·URL 로드 같은 문맥 전환 시점에만 advActive 기준으로)
  if (advActive()) $('#optsAdv').open = true;
  const url = apiUrl(state);
  $('#urlBox').innerHTML = '';
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.textContent = url;
  $('#urlBox').appendChild(a);
  // 저장된 프리셋 기반이면 짧은 URL + 프리셋 이름 표시, 드롭다운 선택 상태도 동기화
  // (자리는 항상 유지 — visibility 로만 토글해 레이아웃 점프 방지)
  const short = shortApiUrl(state);
  $('#shortLine').classList.toggle('ghosted', !short);
  if (short) {
    const sa = $('#shortA');
    sa.href = short; sa.textContent = short;
    $('#shortLine').dataset.url = short;
    $('#shortLine').querySelector('.stag').textContent = shared.loadedPreset.name ? shared.loadedPreset.name : t('짧은 URL', 'Short URL');
    $('#teamSel').value = shared.loadedPreset.sid;
    $('#teamSel').classList.add('active'); // 선택됨 — 진한 표시
  } else {
    $('#teamSel').value = ''; // 저장본과 달라짐 → 선택 해제
    $('#teamSel').classList.remove('active');
  }
  syncAddressBar(state);
  clearTimeout(timer);
  timer = setTimeout(() => preview(url), 300);
}

let loadingTimer = null;
export function setLoading(on) {
  $('#statusLine').style.opacity = on ? '.4' : '';
  $('#preview').style.opacity = on ? '.55' : '';
}

async function preview(url) {
  const seq = ++reqSeq;
  const t0 = performance.now();
  // 빠른 응답(<250ms)은 로딩 표시 없이 조용히 교체 — 깜빡임 방지.
  // 느린 응답(_delay 등)만 기존 내용을 흐리게 해서 진행 중임을 알림.
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => setLoading(true), 250);
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': LANG } });
    const text = await res.text();
    if (seq !== reqSeq) return; // 오래된 응답 무시
    clearTimeout(loadingTimer);
    setLoading(false);
    const ms = Math.round(performance.now() - t0);
    const cls = res.ok ? 'ok' : 'err';
    $('#statusLine').innerHTML = 'HTTP <span class="' + cls + '">' + res.status + '</span> · ' + ms + 'ms';
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('x-ndjson')) {
      shared.lastPreviewText = text;
      renderNdjson(text);
    } else if (ct.includes('text/csv')) {
      shared.lastPreviewText = text;
      renderCsv(text);
    } else {
      let body = text;
      let isJson = false;
      try { body = JSON.stringify(JSON.parse(text), null, 2); isJson = true; } catch {}
      shared.lastPreviewText = body;
      if (isJson) $('#preview').innerHTML = highlightJson(body);
      else $('#preview').textContent = body;
    }
  } catch (e) {
    if (seq !== reqSeq) return;
    clearTimeout(loadingTimer);
    setLoading(false);
    $('#statusLine').innerHTML = '<span class="err">' + t('요청 실패', 'Request failed') + '</span>';
    shared.lastPreviewText = String(e);
    $('#preview').textContent = String(e);
  }
}

