import { $ } from './dom.js';
import { t } from './i18n.js';
import { highlightJson, parseCsv } from './pure.js';

// NDJSON — 줄 번호 + 줄별 구문 하이라이팅
export function renderNdjson(text) {
  const MAX = 200;
  const lines = text.trimEnd().split('\n').filter((l) => l !== '');
  let html = '';
  lines.slice(0, MAX).forEach((l, i) => {
    html += '<div class="nd-row"><span class="nd-no">' + (i + 1) + '</span><span class="nd-json">' + highlightJson(l) + '</span></div>';
  });
  if (lines.length > MAX) html += '<div class="pv-more">' + t('… 외 ' + (lines.length - MAX) + '줄 — 미리보기는 ' + MAX + '줄까지 (복사는 전체)', '… ' + (lines.length - MAX) + ' more lines — preview shows up to ' + MAX + ' (copy gets everything)') + '</div>';
  $('#preview').innerHTML = html || t('(빈 응답)', '(empty response)');
}

export function renderCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 1) { $('#preview').textContent = text; return; }
  const MAX = 100;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '<table class="csv-t"><thead><tr>' + rows[0].map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
  for (const r of rows.slice(1, MAX + 1)) {
    html += '<tr>' + r.map((c) => '<td title="' + esc(c).replace(/"/g, '&quot;') + '">' + esc(c) + '</td>').join('') + '</tr>';
  }
  html += '</tbody></table>';
  if (rows.length - 1 > MAX) html += '<div class="pv-more">' + t('… 외 ' + (rows.length - 1 - MAX) + '행 — 미리보기는 ' + MAX + '행까지 (복사는 전체)', '… ' + (rows.length - 1 - MAX) + ' more rows — preview shows up to ' + MAX + ' (copy gets everything)') + '</div>';
  $('#preview').innerHTML = html;
}
