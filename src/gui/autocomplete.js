import { applyLock } from './dom.js';
import { LANG } from './i18n.js';
import { update } from './preview.js';

let typeOptions = null; // /schema/types 응답 — 단일 소스

// ---- 타입 자동완성 (커스텀 드롭다운 — 높이 제한 + 스크롤 + 키보드) ----
let AC_ITEMS = [];
function buildAcItems() {
  AC_ITEMS = [];
  if (!typeOptions) return;
  for (const p of typeOptions.fakerPaths) AC_ITEMS.push({ v: p.value, l: p.label });
  for (const t of typeOptions.dslTypes) AC_ITEMS.push({ v: t.example, l: t.label });
}

/** 타입 목록을 받아 자동완성 항목을 채운다 — 실패해도 GUI 나머지는 동작해야 하므로 조용히 빈 목록 */
export async function initAutocomplete() {
  try {
    typeOptions = await (await fetch('/schema/types', { headers: { 'Accept-Language': LANG } })).json();
  } catch { typeOptions = { fakerPaths: [], dslTypes: [] }; }
  buildAcItems();
}

const ac = document.createElement('div');
ac.className = 'ac';
document.body.appendChild(ac);
let acInput = null, acSel = -1, acList = [];

export function acClose() { ac.style.display = 'none'; acInput = null; acSel = -1; }

export function acRender(input) {
  if (input.readOnly || !AC_ITEMS.length) return;
  acInput = input;
  const q = input.value.trim().toLowerCase();
  acList = q ? AC_ITEMS.filter((it) => it.v.toLowerCase().includes(q) || it.l.toLowerCase().includes(q)) : AC_ITEMS;
  if (!acList.length) { ac.style.display = 'none'; return; }
  acSel = -1;
  ac.innerHTML = '';
  acList.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'ac-item';
    d.dataset.i = i;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = it.v;
    const l = document.createElement('span'); l.className = 'l'; l.textContent = it.l;
    d.append(v, l);
    ac.appendChild(d);
  });
  const r = input.getBoundingClientRect();
  ac.style.display = 'block';
  ac.style.left = (r.left + scrollX) + 'px';
  ac.style.top = (r.bottom + scrollY + 4) + 'px';
  ac.style.width = Math.max(r.width, 280) + 'px';
  ac.scrollTop = 0;
}

function acHighlight() {
  [...ac.children].forEach((el, i) => el.classList.toggle('sel', i === acSel));
  if (acSel >= 0) ac.children[acSel].scrollIntoView({ block: 'nearest' });
}

function acApply(i) {
  if (!acInput || i < 0 || i >= acList.length) return;
  acInput.value = acList[i].v;
  const row = acInput.closest('.frow');
  acClose();
  applyLock(row);
  update();
}

/**
 * 드롭다운이 열려 있을 때의 키 처리 — 소비했으면 true.
 * 선택 커서(acSel)가 이 모듈 밖으로 나가지 않도록 키 분기를 여기에 둔다
 * (import 바인딩은 재대입할 수 없어서, 호출부에서 acSel 을 직접 못 움직인다).
 */
export function acKeydown(e) {
  if (!acInput || ac.style.display !== 'block') return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); acSel = Math.min(acSel + 1, acList.length - 1); acHighlight(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); acSel = Math.max(acSel - 1, 0); acHighlight(); return true; }
  if (e.key === 'Enter' && acSel >= 0) { e.preventDefault(); acApply(acSel); return true; }
  if (e.key === 'Escape') { acClose(); return true; }
  return false;
}

ac.addEventListener('mousedown', (e) => {
  e.preventDefault(); // 포커스 유지 (blur 방지)
  const item = e.target.closest('.ac-item');
  if (item) acApply(parseInt(item.dataset.i, 10));
});
window.addEventListener('scroll', (e) => {
  if (e.target === ac || ac.contains(e.target)) return;
  acClose();
}, true);
window.addEventListener('resize', acClose);
