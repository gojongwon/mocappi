import { t } from './i18n.js';

export const $ = (s) => document.querySelector(s);
export const fieldsEl = $('#fields');
// ---- 필드 행 ----
// 인자가 없어 직접 수정할 일이 없는 타입 — 입력 잠금 (▾ 로 교체, ✕ 로 삭제는 가능)
const ARGLESS_TYPES = ['uuid', 'index'];

export function applyLock(row) {
  const fv = row.querySelector('.fval');
  const locked = ARGLESS_TYPES.includes(fv.value.trim());
  fv.readOnly = locked;
  fv.classList.toggle('locked', locked);
  fv.title = locked
    ? fv.value + t(' — 인자가 없는 타입이라 수정할 게 없어요. 직접 고치려면 더블클릭.', ' — this type takes no arguments, so there is nothing to edit. Double-click to edit anyway.')
    : fv.value;
  const fn = row.querySelector('.fname');
  fn.title = fn.value;
}

/**
 * OS/브라우저 자동완성 바(iOS 열쇠·지갑·주소 등) 억제 힌트.
 * 목업 도구의 입력은 개인정보 필드가 아닌데 브라우저가 추측으로 AutoFill 바를 띄운다.
 * (OS 가 최종 결정권을 가지므로 100% 보장은 아님 — 표준 억제 수단 총동원)
 */
export function hardenInputs(root) {
  for (const el of (root || document).querySelectorAll('input, textarea, select')) {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-1p-ignore', '');      // 1Password
    el.setAttribute('data-lpignore', 'true');   // LastPass
    el.setAttribute('data-form-type', 'other'); // Dashlane 등
  }
}

export function addRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'frow';
  row.innerHTML =
    '<input class="fname" placeholder="' + t('필드명 (중첩은 a.b)', 'field name (a.b for nested)') + '" spellcheck="false">' +
    '<input class="fval" placeholder="' + t('타입 — 클릭하면 목록', 'type — click for the list') + '" spellcheck="false" autocomplete="off">' +
    '<button class="del" title="' + t('필드 삭제', 'Remove field') + '">✕</button>';
  row.querySelector('.fname').value = name;
  row.querySelector('.fval').value = value;
  applyLock(row);
  hardenInputs(row);
  fieldsEl.appendChild(row);
  return row;
}

// ---- 클립보드 ----
async function writeClipboard(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

export async function copyText(t, btn, done) {
  await writeClipboard(t);
  const orig = btn.textContent;
  btn.textContent = done; setTimeout(() => (btn.textContent = orig), 1200);
}

// 아이콘 복사 버튼 (lucide copy/check)
export const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
export const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#23a55a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export async function copyIcon(t, btn) {
  await writeClipboard(t);
  btn.innerHTML = ICON_CHECK;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => (btn.innerHTML = ICON_COPY), 1200);
}

