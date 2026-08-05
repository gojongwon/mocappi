import { $, on } from './dom.js';
import { LANG, t } from './i18n.js';
import { highlightJson, prettyJson } from './pure.js';
import { shared } from './shared.js';
import { readState, setMethod, shortApiUrl } from './url-state.js';

// ---- 프리셋 상태 패널 — 워크스페이스 프리셋의 쓰기를 GUI 에서 실제로 보내본다 ----
//
// 미리보기는 상태를 오염시키지 않도록 바디 없이 나간다 (서버가 바디 없는 쓰기를
// 무상태로 처리). 그래서 "진짜 쓰기"는 이 패널의 보내기 버튼 — 명시적 클릭 —
// 으로만 나간다. 성공하면 GET 으로 전환해 목록에서 변화가 바로 보이게 한다:
// mutation → refetch 를 눈으로 확인시키는 게 이 패널의 존재 이유다.

const WRITES = new Set(['post', 'put', 'patch', 'delete']);
/** 상태 자격 — 워크스페이스 프리셋(_s=<ws>.<id>)이 로드되어 짧은 URL 이 살아 있을 때 */
const wsSid = () =>
  shared.loadedPreset && shared.loadedPreset.sid.includes('.') ? shared.loadedPreset.sid : null;

on('schema:changed', syncStateBar);

// 메시지는 "그 메서드의 결과"다 — 메서드를 바꾸면 지운다. 성공 메시지는 setMethod('get')
// 뒤에 쓰므로 GET 전환은 살아남고, 이후 다른 메서드를 고르는 순간 사라진다
let msgMethod = null;

function msg(text, ok) {
  const el = $('#stateMsg');
  el.textContent = text;
  el.style.color = ok === undefined ? 'var(--muted)' : ok ? 'var(--ok)' : 'var(--danger)';
  msgMethod = $('#oMethod').value;
}

// ---- 바디 편집기 — 실패 바디(url-state.paintBody)와 같은 문법: 고스트·Tab·하이라이트·자동 정렬 ----

/** DSL 타입 → 고스트용 예시 값. 정확할 필요는 없다 — "이런 모양으로 보내라"는 안내다 */
function sampleFor(type) {
  if (type.startsWith('int:')) return parseInt(type.slice(4), 10) || 1;
  if (type.startsWith('float:')) return 1.5;
  if (type.startsWith('bool')) return true;
  if (type.startsWith('enum:')) return type.slice(5).split('|')[0].replace(/\*[\d.]+$/, '');
  if (type.startsWith('const:')) return type.slice(6);
  if (type.includes('email')) return 'hong@example.com';
  if (type.startsWith('person.') || type.includes('name')) return t('홍길동', 'Hong Gildong');
  return t('새 값', 'new value');
}

/** 현재 스키마에서 뽑은 예시 바디 — id·배열·중첩은 빼고 스칼라 필드 앞 두 개 */
function ghostBody() {
  const picks = [];
  for (const [name, type] of readState().fields) {
    if (name === 'id' || name.endsWith('[]') || name.includes('.')) continue;
    picks.push([name, sampleFor(type)]);
    if (picks.length === 2) break;
  }
  if (!picks.length) return null;
  return JSON.stringify(Object.fromEntries(picks), null, 2);
}

let ghost = null;

function paintStateBody() {
  const ta = $('#stateBody');
  const hl = $('#stateBodyHl');
  if (document.activeElement !== ta && ta.value !== '') {
    const out = prettyJson(ta.value);
    if (out !== null) ta.value = out; // 자동 정렬은 포커스가 없을 때만 — 캐럿 보호 (paintBody 와 동일)
  }
  const empty = ta.value === '';
  ghost = empty ? ghostBody() : null;
  hl.classList.toggle('ghost', empty);
  hl.innerHTML = highlightJson(empty ? (ghost ?? '{}') : ta.value) + '\n'; // pre 가 끝 줄바꿈을 삼키는 것 보정
  $('#stateBodyHint').hidden = ghost === null;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, hl.scrollHeight) + 'px';
}

export function formatStateBody() {
  const ta = $('#stateBody');
  const out = prettyJson(ta.value);
  if (out === null) return false;
  ta.value = out;
  paintStateBody();
  return true;
}

// 위임으로 못 받는 이벤트는 직접 건다 (main.js 의 #oBody 블록과 같은 이유) —
// input 은 schema:changed 대상이 아니라서(바디는 스키마가 아니다) 여기서 하이라이트만 갱신한다
{
  const ta = $('#stateBody');
  ta.addEventListener('input', paintStateBody);
  ta.addEventListener('scroll', () => { $('#stateBodyHl').scrollTop = ta.scrollTop; });
  ta.addEventListener('paste', () => setTimeout(paintStateBody, 0));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && ta.value === '' && ghost !== null) {
      e.preventDefault();
      ta.value = ghost;
      paintStateBody();
    }
  });
}

export function syncStateBar() {
  const bar = $('#stateBar');
  const sid = wsSid();
  if (!sid || !shortApiUrl(readState())) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'block';
  const method = $('#oMethod').value;
  if (msgMethod !== null && msgMethod !== method) {
    $('#stateMsg').textContent = '';
    msgMethod = null;
  }
  const write = WRITES.has(method);
  $('#stateIdRow').style.display = write && method !== 'post' ? 'block' : 'none';
  const bodyOn = write && method !== 'delete';
  $('#stateBodyWrap').style.display = bodyOn ? 'block' : 'none';
  if (bodyOn) paintStateBody(); // 스키마가 바뀌면 고스트도 새 필드 기준으로
  $('#stateSend').style.display = write ? 'inline-block' : 'none';
  $('#stateSend').textContent = method.toUpperCase() + ' ' + t('보내기', 'Send');
  const HINTS = {
    post: t('JSON 바디를 보내면 진짜 생성됩니다 — 성공하면 GET 목록으로 전환해 보여드려요.',
            'Send a JSON body and it is really created — on success we switch to the GET list to show it.'),
    put: t('통째로 교체합니다 — 안 보낸 필드는 사라져요. 부분 수정은 PATCH 를 쓰세요.',
           'Replaces the whole item — fields you omit disappear. For partial edits use PATCH.'),
    patch: t('보낸 필드만 바뀝니다 — 목록 응답에서 고칠 아이템의 id 를 복사해 넣으세요.',
             "Only the fields you send change — copy the target item's id from a list response."),
    delete: t('목록 응답에서 지울 아이템의 id 를 복사해 넣으세요.',
              'Copy the id of the item to delete from a list response.'),
  };
  $('#stateHint').textContent = write
    ? HINTS[method]
    : t('위 메서드에서 POST·PUT·PATCH·DELETE 를 고르면 여기서 실제로 보낼 수 있어요. 쓴 상태는 24시간 뒤 사라집니다.',
        'Pick POST·PUT·PATCH·DELETE above to actually send one from here. Written state expires after 24h.');
}

export async function sendStateWrite() {
  const sid = wsSid();
  const short = shortApiUrl(readState());
  if (!sid || !short) return;
  const method = $('#oMethod').value.toUpperCase();
  if (!WRITES.has(method.toLowerCase())) return;

  const id = $('#stateId').value.trim();
  const bodyText = $('#stateBody').value.trim();
  if (method !== 'DELETE') {
    if (!bodyText) return msg(t('JSON 바디를 입력하세요. 예: {"name": "홍길동"}', 'Enter a JSON body, e.g. {"name": "Hong Gildong"}'), false);
    try { JSON.parse(bodyText); } catch { return msg(t('바디가 올바른 JSON 이 아닙니다.', 'The body is not valid JSON.'), false); }
  }
  if (method !== 'POST' && !id) {
    return msg(t('대상 아이템의 id 가 필요합니다 — 목록 응답에서 복사하세요.', 'The target item’s id is required — copy it from a list response.'), false);
  }

  // 짧은 URL 의 쿼리 앞에 /<id> 경로 세그먼트를 끼운다 — 서버가 경로 마지막 세그먼트를 대상 id 로 읽는다
  const qi = short.indexOf('?');
  const url = id ? short.slice(0, qi) + '/' + encodeURIComponent(id) + short.slice(qi) : short;

  const btn = $('#stateSend');
  btn.disabled = true;
  msg(t('보내는 중…', 'Sending…'));
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'Accept-Language': LANG },
      body: method === 'DELETE' ? undefined : bodyText,
    });
    if (res.ok) {
      if (method === 'POST') {
        // 생성물의 id 를 채워 둔다 — 이어서 PATCH/DELETE 를 바로 해볼 수 있게
        try { $('#stateId').value = String((await res.json()).id ?? ''); } catch { /* 바디 없음 */ }
      }
      setMethod('get'); // GET 으로 전환 → 미리보기가 refetch → 변화가 눈에 보인다
      // 메시지는 전환 뒤에 — setMethod 의 schema:changed(동기)가 메서드 변경 시 메시지를
      // 지우므로, 먼저 쓰면 방금 쓴 성공 메시지가 그 자리에서 지워진다
      msg('✓ ' + res.status + ' ' + t('반영됨 — 목록에서 확인하세요', 'applied — check the list'), true);
    } else {
      const b = await res.json().catch(() => ({}));
      msg('✗ ' + res.status + ' ' + (b.hint || b.message || b.error || t('실패', 'failed')), false);
    }
  } catch (e) {
    msg(t('요청 실패: ', 'Request failed: ') + e, false);
  } finally {
    btn.disabled = false;
  }
}

export async function resetStateNow() {
  const sid = wsSid();
  if (!sid) return;
  try {
    const res = await fetch('/schema/state/' + sid, { method: 'DELETE', headers: { 'Accept-Language': LANG } });
    const b = await res.json().catch(() => ({}));
    if (res.ok) {
      setMethod('get'); // 초기화 결과도 목록으로 바로 확인 — 메시지는 전환 뒤에 (sendStateWrite 와 같은 순서)
      msg('✓ ' + (b.hint || t('상태가 초기화되었습니다.', 'State reset.')), true);
    } else {
      msg('✗ ' + (b.hint || b.error || t('초기화 실패', 'Reset failed')), false);
    }
  } catch (e) {
    msg(t('요청 실패: ', 'Request failed: ') + e, false);
  }
}
