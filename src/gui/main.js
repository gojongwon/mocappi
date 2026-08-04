import { acClose, acKeydown, acRender, initAutocomplete } from './autocomplete.js';
import { $, ICON_COPY, addRow, applyLock, closeModal, copyIcon, copyText, emit, hardenInputs, openModal, writeClipboard } from './dom.js';
import { LANG, applyEn, t } from './i18n.js';
import { applyPaste, closePaste, openPaste } from './paste.js';
import './preview.js'; // schema:changed 구독자 — 부수효과만, export 없음
import { enc, snippet } from './pure.js';
import { applyDeletePreset, applySave, askDeletePreset, loadTeamPreset, openSave, refreshTeam, renderTeamOptions, syncTeamSelVisibility, unloadTeamPreset } from './save.js';
import { enhanceSelects, setRowDelete } from './select.js';
import { shared } from './shared.js';
import { OPT_DEFAULTS, OPT_INPUTS, PRESETS, acceptGhost, advActive, apiUrl, applyPreset, buildQuery, formatBody, loadFromAddressBar, readState, setMethod, setOptKeys } from './url-state.js';
import { joinWs, randWs, switchWs, syncWsUi } from './workspace.js';

if (LANG === 'en') applyEn();
// 토글은 리로드 방식 — 해시만 바꾸므로 스키마 상태(location.search)는 건드리지 않는다
$('#langLabel').textContent = LANG === 'en' ? 'KO' : 'EN';

// ---- 스키마 내보내기 (#copySel) ----
//
// 다섯 형식이 두 갈래다. 호출 스니펫(curl·fetch·python)은 URL 만 있으면 되니 여기서 만들고,
// 타입·스펙 문서는 같은 쿼리를 서버에 넘겨 텍스트로 받는다 — 다른 건 경로뿐이다.
const EXPORT_PATHS = { ts: '/schema/ts', openapi: '/schema/openapi' };

/**
 * placeholder <option> 을 잠깐 다른 문구로 — 닫힌 select 가 그 자리를 그리므로 이게 피드백이다.
 * 되돌릴 라벨을 textContent 에서 읽지 않고 t() 로 다시 만드는 이유: 1.2초 안에 또 고르면
 * '복사됨 ✓' 를 원래 라벨로 착각해 영영 그 상태로 남는다. 드롭다운은 연달아 고르는 물건이다.
 */
function flashExport(ph, msg, ms) {
  ph.textContent = msg;
  clearTimeout(ph._t);
  ph._t = setTimeout(() => (ph.textContent = t('내보내기', 'Export')), ms);
}

async function runExport(sel, kind) {
  const ph = sel.options[0];
  sel.value = ''; // 즉시 되돌린다 — 같은 항목을 다시 골라도 change 가 떠야 한다 (#teamSel 과 동일)
  const state = readState();
  const ok = () => flashExport(ph, t('복사됨 ✓', 'Copied ✓'), 1200);

  if (!EXPORT_PATHS[kind]) {
    // URL 만 복사하면 메서드가 빠진다 — apiUrl 은 메서드 중립이라 스니펫이 그걸 채운다
    await writeClipboard(snippet(kind, apiUrl(state), state.opts._method || 'GET'));
    return ok();
  }
  try {
    const res = await fetch(EXPORT_PATHS[kind] + '?' + buildQuery(state) + '&_res=' + enc(state.res), { headers: { 'Accept-Language': LANG } });
    const text = await res.text();
    if (!res.ok) return flashExport(ph, t('URL 오류', 'Bad URL'), 1500);
    await writeClipboard(text);
    ok();
  } catch {
    flashExport(ph, t('요청 실패', 'Request failed'), 1500);
  }
}
// ---- 이벤트 ----
// Escape·배경 클릭으로 닫히는 모달. 새 소식·피드백은 여기 없다 — 지금 동작 그대로 유지
const DISMISSABLE = ['pasteModal', 'helpModal', 'saveModal', 'wsModal', 'delModal'];
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
  // WebKit 은 type=search 에서 Esc 로 값을 지운다 (hardenInputs 가 타입을 바꾼 대가).
  // 기본 동작만 죽인다 — 아래 자동완성 닫기·모달 닫기는 그대로 돈다
  if (e.key === 'Escape' && e.target && e.target.type === 'search') e.preventDefault();
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
// 드롭다운 행별 삭제 — select.js 는 문구도 확인 방식도 모른다. 둘을 아는 건 진입점인 여기다
setRowDelete(askDeletePreset, t('이 프리셋 삭제', 'Delete this preset'));

const modalObserver = new MutationObserver(syncScrollLock);
for (const id of MODAL_IDS) {
  const el = $('#' + id);
  if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'copySel') {
    if (e.target.value) runExport(e.target, e.target.value);
    return;
  }
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
  // 모달 코너 ✕ — 7개 모달의 닫기가 전부 closeModal 하나라 분기도 하나면 된다
  if (btn.dataset && btn.dataset.close) { closeModal(btn.dataset.close); return; }
  switch (btn.id) {
    // 언어 토글 — 해시만 바꾸고 리로드 (스키마 상태는 location.search 에 있어 안전)
    case 'langBtn': location.hash = LANG === 'en' ? '#ko' : '#en'; location.reload(); break;
    case 'addField': addRow(); break;
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
    case 'delCancel': closeModal('delModal'); break;
    case 'delApply': applyDeletePreset(); break;
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
  // Tab 은 빈 칸 + 고스트일 때만 가로챈다 — 그 외엔 포커스 이동 그대로.
  // (빈 칸에서 이 칸을 건너뛰려면 Shift+Tab. 채우고 나면 Tab 도 정상 동작한다)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && ta.value === '' && acceptGhost()) e.preventDefault();
  });
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
