import { $, addRow, emit, fieldsEl } from './dom.js';
import { LANG, t } from './i18n.js';
import { shared } from './shared.js';

// ---- JSON 붙여넣기 → 추론 ----
export function openPaste() {
  $('#pasteError').textContent = '';
  $('#pasteModal').style.display = 'flex';
  $('#pasteInput').focus();
}
export function closePaste() { $('#pasteModal').style.display = 'none'; }

export async function applyPaste() {
  const raw = $('#pasteInput').value.trim();
  if (!raw) { $('#pasteError').textContent = t('JSON 을 입력하세요.', 'Enter some JSON.'); return; }
  // "data": {...} 처럼 바깥 중괄호 없는 조각도 감싸서 재시도
  let body = null;
  for (const candidate of [raw, '{' + raw + '}', '{' + raw.replace(/,\s*$/, '') + '}']) {
    try { JSON.parse(candidate); body = candidate; break; } catch {}
  }
  if (body === null) {
    try { JSON.parse(raw); }
    catch (e) { $('#pasteError').textContent = t('JSON 파싱 실패: ', 'JSON parse error: ') + e.message; return; }
  }
  let result;
  try {
    const res = await fetch('/schema/infer', { method: 'POST', body, headers: { 'content-type': 'application/json', 'Accept-Language': LANG } });
    result = await res.json();
    if (!res.ok) { $('#pasteError').textContent = (result.error || t('추론 실패', 'Inference failed')) + (result.hint ? ' — ' + result.hint : ''); return; }
  } catch (e) { $('#pasteError').textContent = t('요청 실패: ', 'Request failed: ') + e; return; }
  shared.loadedPreset = null; shared.preloadSnapshot = null; // 붙여넣기로 새 스키마 시작 — 저장본과 무관
  fieldsEl.innerHTML = '';
  for (const f of result.fields) addRow(f.name, f.type);
  const note = $('#inferNote');
  const lines = [];
  if (result.note) lines.push('ℹ ' + result.note);
  if (result.skipped && result.skipped.length) {
    lines.push(t('추론에서 제외됨:', 'Excluded from inference:'));
    for (const s of result.skipped) lines.push('· ' + s.path + ' — ' + s.reason);
  }
  if (lines.length) {
    note.textContent = lines.join('\n');
    note.style.display = 'block';
    clearTimeout(note._t); note._t = setTimeout(() => (note.style.display = 'none'), 15000);
  } else {
    note.style.display = 'none';
  }
  closePaste();
  emit('schema:changed');
}

