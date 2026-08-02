import { t } from './i18n.js';

export const $ = (s) => document.querySelector(s);
export const fieldsEl = $('#fields');

// ---- 최소 이벤트 버스 ----
// 모듈 간 순환을 만들지 않으려고 직접 호출 대신 쓴다. 여기 있는 이유는 dom.js 가
// i18n 만 의존하면서 모든 모듈이 이미 import 하는 유일한 자리라서 — 새 간선이 0이다.
// dispatchEvent 는 동기다: 발신 지점에서 수신자가 끝까지 돌고 나서 다음 줄로 간다.
export const emit = (name) => document.dispatchEvent(new CustomEvent(name));
export const on = (name, fn) => document.addEventListener(name, fn);

// 모달 표시 — display 를 감시하는 MutationObserver 가 배경 스크롤 잠금을 따라간다 (main.js)
export const openModal = (id) => { $('#' + id).style.display = 'flex'; };
export const closeModal = (id) => { $('#' + id).style.display = 'none'; };
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
 * OS/브라우저 자동완성 바(iOS 열쇠·지갑·주소 등)와 비밀번호 관리자 확장 억제 힌트.
 * 목업 도구의 입력은 개인정보 필드가 아닌데, 필드 행이 텍스트 입력 두 개가 나란한 모양이라
 * 관리자 확장이 아이디/비밀번호 쌍으로 오인해 열쇠 아이콘을 박는다.
 *
 * 한계: 사이트가 끌 수 있는 건 각 확장이 스스로 지원하는 무시 속성뿐이다.
 * 그런 수단이 없는 확장(일부 국내 브라우저 내장 관리자 등)은 확장 설정에서만 끌 수 있다.
 */
export function hardenInputs(root) {
  for (const el of (root || document).querySelectorAll('input, textarea, select')) {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-1p-ignore', '');              // 1Password
    el.setAttribute('data-lpignore', 'true');           // LastPass
    el.setAttribute('data-bwignore', 'true');           // Bitwarden
    el.setAttribute('data-protonpass-ignore', 'true');  // Proton Pass
    el.setAttribute('data-form-type', 'other');         // Dashlane 등
    // 위 속성들을 다 무시하는 확장이 있다. 관리자는 text/email/tel/password 를 노리고
    // search 는 건너뛰므로, 타입을 바꾸면 확장 종류를 안 가린다.
    // text↔search 는 value 모드가 같아 값이 보존된다 (addRow 가 값 설정 뒤에 부른다).
    if (el.tagName === 'INPUT' && (el.type === 'text' || !el.hasAttribute('type'))) el.type = 'search';
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
const ICON_CHECK ='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#23a55a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export async function copyIcon(t, btn) {
  await writeClipboard(t);
  btn.innerHTML = ICON_CHECK;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => (btn.innerHTML = ICON_COPY), 1200);
}

