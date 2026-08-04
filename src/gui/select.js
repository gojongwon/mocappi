/**
 * <select> 드롭다운을 아래로 펼친다.
 *
 * 네이티브 select 의 팝업은 OS 가 그리고, macOS 는 선택된 항목을 컨트롤 위에 겹쳐 띄운다.
 * 스티키 헤더의 #teamSel 이 로고·제목을 덮어 깨져 보이는 게 그 때문 — CSS 로는 못 바꾼다.
 *
 * <select> 자체는 DOM 에 그대로 둔다. 선택된 항목 텍스트를 브라우저가 계속 그려주므로
 * 라벨 동기화가 필요 없고, .value 를 읽고 쓰는 기존 코드도 손댈 게 없다.
 * 가로채는 건 마우스뿐 — 포커스된 select 는 팝업 없이도 ↑↓ 로 값이 바뀌고 type-ahead 가
 * 동작하므로 키보드 경로는 네이티브 그대로 두는 편이 접근성에도 낫다.
 * (그래서 프리셋 삭제 ✕ 도 마우스·터치 전용이다 — 키보드 경로엔 팝업 자체가 없다)
 *
 * 이 파일은 아무것도 import 하지 않는다. 문구도 삭제 동작도 밖에서 주입받는다(setRowDelete) —
 * 그래야 테스트가 가짜 DOM 하나로 이 위젯만 돌릴 수 있다.
 */

// 팝업 하나를 모든 select 가 공유 — 자동완성(.ac)의 스타일·z-index·스크롤을 그대로 쓴다
const pop = document.createElement('div');
pop.className = 'ac';
document.body.appendChild(pop);

let owner = null;
// 행 삭제 주입 — { ask, title }. 없으면 ✕ 를 그리지 않는다 (main.js 가 등록한다)
let rowDel = null;

/**
 * 행별 삭제를 켠다. 확인도 삭제도 여기서 하지 않는다 — `ask(sid, label)` 로 넘기고 끝이다.
 * 문구를 밖에서 받는 이유: 이 파일은 i18n 을 import 하지 않는다 (ko/en 짝은 부르는 쪽 책임).
 */
export function setRowDelete(ask, title) {
  rowDel = { ask, title };
}

export function closeSelectPop() {
  pop.style.display = 'none';
  owner = null;
}

function row(opt) {
  const d = document.createElement('div');
  d.className = 'ac-item' + (opt.selected ? ' sel' : '');
  d.textContent = opt.textContent;
  if (opt.disabled) d.setAttribute('aria-disabled', 'true');
  else d.dataset.v = opt.value;
  // 지울 수 있는 항목(save.js 가 표시)에만 ✕. 클래스가 del 이면 안 된다 —
  // main.js 의 click 위임이 .del 을 필드 행 삭제로 잡아 closest('.frow') 에서 터진다
  if (opt.dataset.del && rowDel) {
    const b = document.createElement('button');
    b.className = 'ac-x';
    b.dataset.sid = opt.dataset.del;
    b.textContent = '✕';
    b.title = rowDel.title;
    b.dataset.label = opt.textContent; // 확인 문구에 어느 프리셋인지 넣는다
    d.appendChild(b);
  }
  return d;
}

function openFor(sel) {
  owner = sel;
  pop.innerHTML = '';
  // options 가 아니라 children 을 도는 이유: <optgroup> 라벨도 그려야 한다
  // (모바일 #teamSel 이 "기본 프리셋"/"내 프리셋" 으로 나뉜다)
  for (const node of sel.children) {
    if (node.tagName === 'OPTGROUP') {
      const g = document.createElement('div');
      g.className = 'ac-group';
      g.textContent = node.label;
      pop.appendChild(g);
      for (const o of node.children) pop.appendChild(row(o));
    } else {
      pop.appendChild(row(node));
    }
  }
  const r = sel.getBoundingClientRect();
  pop.style.display = 'block';
  pop.style.left = (r.left + scrollX) + 'px';
  pop.style.top = (r.bottom + scrollY + 4) + 'px';
  pop.style.minWidth = r.width + 'px';
  const cur = pop.querySelector('.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function apply(value) {
  const sel = owner;
  closeSelectPop();
  sel.value = value;
  // 네이티브도 둘 다 쏜다. main.js 의 위임이 옵션 패널은 input('.opts select'),
  // #teamSel 은 change 로 잡으므로 하나만 쏘면 한쪽이 죽는다.
  for (const type of ['input', 'change']) sel.dispatchEvent(new Event(type, { bubbles: true }));
}

export function enhanceSelects() {
  document.addEventListener('mousedown', (e) => {
    const at = (s) => (e.target.closest ? e.target.closest(s) : null);

    // ✕ 는 .ac-item 안에 있어 closest('.ac-item') 에도 걸린다 — 반드시 먼저 본다
    const del = rowDel && at('.ac-x');
    if (del && pop.contains(del)) {
      e.preventDefault(); // 아래 값 선택으로 흘러가지 않게
      // 팝업(z-index 30)은 모달(20) 보다 위라 확인창 위로 떠버린다 — 먼저 치운다
      closeSelectPop();
      rowDel.ask(del.dataset.sid, del.dataset.label);
      return;
    }

    // 팝업 안 클릭 — preventDefault 로 select 포커스를 유지한 채 값만 바꾼다
    const item = at('.ac-item');
    if (item && pop.contains(item)) {
      e.preventDefault();
      if (item.dataset.v !== undefined) apply(item.dataset.v);
      return;
    }

    const sel = at('select');
    if (!sel) { closeSelectPop(); return; }
    e.preventDefault(); // 네이티브 팝업 억제 — 이게 이 파일의 존재 이유
    sel.focus(); // preventDefault 가 포커스까지 막으므로 직접 (키보드 조작을 이어가려면 필요)
    if (owner === sel) closeSelectPop();
    else openFor(sel);
  });

  // 자동완성과 같은 규칙 — 스크롤·리사이즈로 위치가 어긋나면 그냥 닫는다
  window.addEventListener('scroll', (e) => {
    if (e.target === pop || pop.contains(e.target)) return;
    closeSelectPop();
  }, true);
  window.addEventListener('resize', closeSelectPop);
}
