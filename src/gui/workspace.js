import { $ } from './dom.js';
import { t } from './i18n.js';
import { update } from './preview.js';
import { parseWsInput } from './pure.js';
import { refreshTeam } from './save.js';
import { shared } from './shared.js';

// ---- 워크스페이스 (링크를 아는 사람만 접근하는 저장 공간) ----

export function randWs() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return s.slice(0, 12);
}

function sidOf(id) { return shared.ws ? shared.ws + '.' + id : id; }

export function syncWsUi() {
  const btn = $('#wsBtn');
  const inWs = !!shared.ws;
  $('#wsBtnLabel').textContent = inWs ? shared.ws.slice(0, 8) + '…' : t('워크스페이스', 'Workspace');
  btn.classList.toggle('ws-on', inWs);
  btn.title = inWs ? t('현재 워크스페이스: ', 'Current workspace: ') + shared.ws : t('프리셋 저장·공유 공간 만들기/전환', 'Create or switch a preset workspace');
  $('#wsCurrent').textContent = inWs ? t('현재 워크스페이스: ', 'Current workspace: ') + shared.ws : t('아직 워크스페이스를 사용하고 있지 않습니다.', 'You are not in a workspace yet.');
  // 상태에 맞는 동작만 노출: 링크 복사/나가기는 워크스페이스 안에서만 의미가 있음
  $('#wsShare').style.display = inWs ? '' : 'none';
  $('#wsPublic').style.display = inWs ? '' : 'none';
  // 만들기는 밖에서는 주요 동작(파랑), 안에서는 보조 동작(연파랑)
  $('#wsNew').style.background = inWs ? 'var(--accent-soft)' : 'var(--accent)';
  $('#wsNew').style.color = inWs ? 'var(--ink)' : 'var(--accent-text)';
}

export function switchWs(ws) {
  shared.ws = ws;
  shared.loadedPreset = null; shared.preloadSnapshot = null;
  syncWsUi();
  refreshTeam();
  update();
}

export function joinWs() {
  const ws = parseWsInput($('#wsJoin').value);
  if (!ws) {
    $('#wsJoinError').textContent = t('워크스페이스 ID 를 인식할 수 없습니다. 소문자 영숫자 6~24자, 또는 _ws= 가 포함된 링크를 붙여넣으세요.', 'Could not recognize a workspace ID. Paste 6-24 lowercase letters/digits, or a link containing _ws=.');
    return;
  }
  $('#wsJoinError').textContent = '';
  $('#wsJoin').value = '';
  switchWs(ws);
}

