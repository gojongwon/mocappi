import { acClose, acKeydown, acRender, initAutocomplete } from './autocomplete.js';
import { $, ICON_COPY, addRow, applyLock, closeModal, copyIcon, copyText, emit, hardenInputs, openModal } from './dom.js';
import { LANG, applyEn, t } from './i18n.js';
import { applyPaste, closePaste, openPaste } from './paste.js';
import './preview.js'; // schema:changed 구독자 — 부수효과만, export 없음
import { enc } from './pure.js';
import { applySave, loadTeamPreset, openSave, refreshTeam, renderTeamOptions, syncTeamSelVisibility, unloadTeamPreset } from './save.js';
import { enhanceSelects } from './select.js';
import { shared } from './shared.js';
import { OPT_DEFAULTS, OPT_INPUTS, PRESETS, advActive, apiUrl, applyFailPreset, applyPreset, buildQuery, formatBody, loadDefaultBody, loadFromAddressBar, readState, setMethod, setOptKeys } from './url-state.js';
import { joinWs, randWs, switchWs, syncWsUi } from './workspace.js';

if (LANG === 'en') applyEn();
// 토글은 리로드 방식 — 해시만 바꾸므로 스키마 상태(location.search)는 건드리지 않는다
$('#langLabel').textContent = LANG === 'en' ? 'KO' : 'EN';

// ---- TypeScript 타입 복사 ----
async function copyTsTypes(btn) {
  const state = readState();
  try {
    const res = await fetch('/schema/ts?' + buildQuery(state) + '&_res=' + enc(state.res), { headers: { 'Accept-Language': LANG } });
    const text = await res.text();
    if (!res.ok) { btn.textContent = t('URL 오류', 'Bad URL'); setTimeout(() => (btn.textContent = t('TS 타입 복사', 'Copy TS types')), 1500); return; }
    copyText(text, btn, t('복사됨 ✓', 'Copied ✓'));
  } catch {
    btn.textContent = t('요청 실패', 'Request failed'); setTimeout(() => (btn.textContent = t('TS 타입 복사', 'Copy TS types')), 1500);
  }
}
// ---- 이벤트 ----
// Escape·배경 클릭으로 닫히는 모달. 새 소식·피드백은 여기 없다 — 지금 동작 그대로 유지
const DISMISSABLE = ['pasteModal', 'helpModal', 'saveModal', 'wsModal'];
document.addEventListener('input', (e) => {
  if (e.target.matches('.fname, .fval, #resource, .opts input, .opts select, .opts textarea')) {
    if (e.target.matches('.fname, .fval')) e.target.title = e.target.value;
    if (e.target.matches('.fval')) acRender(e.target);
    emit('schema:changed');
  }
});
// 모바일: 키보드만 내린 상태(포커스 유지)에서 재탭하면 focus 이벤트가 없어
// 드롭다운이 안 열리던 문제 — 탭(click)에도 자동완성을 연다
document.addEventListener('click', (e) => {
  if (e.target.matches && e.target.matches('.fval')) acRender(e.target);
});
document.addEventListener('focusin', (e) => {
  if (e.target.matches && e.target.matches('.fval')) acRender(e.target);
});
// 잠금은 입력이 끝난 뒤(blur)에만 적용 — 타이핑 중에 잠기지 않도록
document.addEventListener('focusout', (e) => {
  if (e.target.matches && e.target.matches('.fval')) {
    applyLock(e.target.closest('.frow'));
    acClose();
  }
});
// 잠긴 타입(uuid/index)도 더블클릭하면 직접 수정 가능
document.addEventListener('dblclick', (e) => {
  if (e.target.matches('.fval.locked')) {
    e.target.readOnly = false;
    e.target.classList.remove('locked');
    e.target.focus();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.id === 'wsJoin') { joinWs(); return; }
  if (acKeydown(e)) return;
  if (e.key === 'Escape') DISMISSABLE.forEach(closeModal);
});
// ---- 모달 배경 스크롤 잠금 (iOS 는 overflow:hidden 만으론 안 됨 → body fixed) ----
const MODAL_IDS = [...DISMISSABLE, 'newsModal', 'fbModal'];
let scrollLockY = 0;
function syncScrollLock() {
  const anyOpen = MODAL_IDS.some((id) => { const el = $('#' + id); return el && el.style.display === 'flex'; });
  const locked = document.body.style.position === 'fixed';
  if (anyOpen && !locked) {
    scrollLockY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = -scrollLockY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
  } else if (!anyOpen && locked) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    window.scrollTo(0, scrollLockY);
  }
}
syncTeamSelVisibility();
renderTeamOptions();
hardenInputs();
enhanceSelects();

const modalObserver = new MutationObserver(syncScrollLock);
for (const id of MODAL_IDS) {
  const el = $('#' + id);
  if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'teamSel') {
    const v = e.target.value;
    if (v.startsWith('preset:')) { applyPreset(v.slice(7)); e.target.value = ''; }
    else if (v) loadTeamPreset(v); // 선택 상태 유지
    else unloadTeamPreset(); // placeholder 재선택 = 해제 + 이전 상태 복원
  }
});
document.addEventListener('click', (e) => {
  // 버튼 안 SVG/span 클릭도 인식하도록 closest 기반으로 판별
  const btn = e.target.closest ? e.target.closest('button, a') : null;
  if (!btn) {
    // 모달 오버레이(배경) 클릭 → 닫기
    if (DISMISSABLE.includes(e.target.id)) closeModal(e.target.id);
    return;
  }
  if (btn.classList.contains('del')) { btn.closest('.frow').remove(); emit('schema:changed'); return; }
  if (btn.dataset && btn.dataset.preset) { applyPreset(btn.dataset.preset); return; }
  if (btn.dataset && btn.dataset.method) { setMethod(btn.dataset.method); return; }
  if (btn.dataset && btn.dataset.fail) { applyFailPreset(btn.dataset.fail); return; }
  switch (btn.id) {
    // 언어 토글 — 해시만 바꾸고 리로드 (스키마 상태는 location.search 에 있어 안전)
    case 'langBtn': location.hash = LANG === 'en' ? '#ko' : '#en'; location.reload(); break;
    case 'addField': addRow(); break;
    case 'oBodyDefault': {
      if (!loadDefaultBody()) { // 200번대면 미리보기가 성공 데이터다
        btn.textContent = t('상태코드 400+', 'Needs status 400+');
        setTimeout(() => (btn.textContent = t('기본값 불러오기', 'Load default')), 1500);
      }
      break;
    }
    case 'oBodyFmt': {
      // 자동 정렬은 포커스가 없을 때만 돌아 손으로 친 JSON 은 안 걸린다 — 그 자리를 메우는 버튼
      const ok = formatBody();
      emit('schema:changed'); // 하이라이트 다시 칠하기
      if (!ok) {
        btn.textContent = t('JSON 오류', 'Invalid JSON');
        setTimeout(() => (btn.textContent = t('{ } 정렬', '{ } Format')), 1500);
      }
      break;
    }
    case 'pasteBtn': case 'welcomePaste': openPaste(); break;
    case 'pasteCancel': closePaste(); break;
    case 'pasteApply': applyPaste(); break;
    case 'helpBtn': case 'helpLink': case 'welcomeHelp':
      e.preventDefault(); openModal('helpModal'); break;
    case 'helpClose': closeModal('helpModal'); break;
    case 'newsBtn': openModal('newsModal'); break;
    case 'newsClose': closeModal('newsModal'); break;
    case 'fbBtn':
      $('#fbStatus').textContent = '';
      openModal('fbModal');
      $('#fbText').focus();
      break;
    case 'fbClose': closeModal('fbModal'); break;
    case 'fbSend': {
      const msg = $('#fbText').value.trim();
      const st = $('#fbStatus');
      if (msg.length < 5) { st.style.color = 'var(--danger)'; st.textContent = t('5자 이상 적어주세요.', 'Please write at least 5 characters.'); break; }
      st.style.color = 'var(--muted)'; st.textContent = t('보내는 중…', 'Sending…');
      fetch('/feedback', { method: 'POST', headers: { 'content-type': 'application/json', 'Accept-Language': LANG }, body: JSON.stringify({ msg }) })
        .then(async (r) => {
          const b = await r.json();
          if (r.ok) {
            st.style.color = 'var(--ok)'; st.textContent = b.hint || t('전달됐어요 — 고맙습니다!', 'Delivered — thank you!');
            $('#fbText').value = '';
            setTimeout(() => closeModal('fbModal'), 1200);
          } else {
            st.style.color = 'var(--danger)'; st.textContent = b.hint || t('전송에 실패했어요.', 'Failed to send.');
          }
        })
        .catch(() => { st.style.color = 'var(--danger)'; st.textContent = t('네트워크 오류 — 잠시 후 다시 시도해주세요.', 'Network error — please try again shortly.'); });
      break;
    }
    case 'welcomeClose': $('#welcome').style.display = 'none'; break;
    case 'copyBtn': copyIcon(apiUrl(readState()), btn); break;
    case 'tsBtn': copyTsTypes(btn); break;
    case 'respCopyBtn': copyIcon(shared.lastPreviewText, btn); break;
    case 'saveBtn': openSave(); break;
    case 'wsBtn': syncWsUi(); openModal('wsModal'); break;
    case 'wsClose': closeModal('wsModal'); break;
    case 'wsNew': switchWs(randWs()); break;
    case 'wsPublic': switchWs(null); break;
    case 'wsShare': copyText(location.href, btn, t('복사됨 ✓', 'Copied ✓')); break;
    case 'wsJoinBtn': joinWs(); break;
    case 'saveWsCreate': switchWs(randWs()); openSave(); break; // 새 워크스페이스 → 저장 이어서
    case 'saveWsJoin': closeModal('saveModal'); syncWsUi(); openModal('wsModal'); break;
    case 'saveCancel': closeModal('saveModal'); break;
    case 'saveApply': applySave(); break;
    case 'shortCopy': copyIcon($('#shortUrlBox').dataset.url || '', btn); break;
    case 'shortLineCopy': copyIcon($('#shortLine').dataset.url || '', btn); break;
  }
});

// 실패 바디 편집기 — 위임으로 못 받는 두 이벤트만 직접 건다.
// scroll 은 버블링이 없고, paste 는 붙여넣은 뒤에야 .value 가 차서 다음 틱에 정렬한다.
{
  const ta = $('#oBody');
  ta.addEventListener('scroll', () => { $('#oBodyHl').scrollTop = ta.scrollTop; });
  ta.addEventListener('paste', () => setTimeout(() => { formatBody(); emit('schema:changed'); }, 0));
}

// ---- 초기화 ----
(async () => {
  // 워크스페이스는 URL 이 곧 상태 — _ws 파라미터로 복원
  const wsParam = new URLSearchParams(location.search).get('_ws');
  if (wsParam && /^[a-z0-9]{6,24}$/.test(wsParam)) shared.ws = wsParam;
  await initAutocomplete();
  refreshTeam();
  // 복사 버튼들을 아이콘으로 초기화
  for (const id of ['copyBtn', 'shortCopy', 'shortLineCopy', 'respCopyBtn']) {
    const b = $('#' + id);
    if (b) b.innerHTML = ICON_COPY;
  }
  if (!loadFromAddressBar()) {
    // 첫 방문(맨 주소): 사용자 프리셋으로 온보딩 + 웰컴 배너.
    // 공유 링크로 들어오면 URL 에 스키마가 있으므로 배너를 띄우지 않는다.
    const p = PRESETS.users;
    $('#resource').value = p.res;
    for (const [n, v] of p.fields) addRow(n, v);
    setOptKeys(null);
    for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = (p.opts && p.opts[k]) || OPT_DEFAULTS[k];
    $('#optsAdv').open = advActive();
    $('#welcome').style.display = 'block';
  }
  emit('schema:changed');
})();
