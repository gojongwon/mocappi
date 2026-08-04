/**
 * select 대체 드롭다운 — 네이티브 팝업을 억제하고 아래로 펼치는 부분.
 * 억제 자체(mousedown preventDefault)는 브라우저에서만 확인 가능하고, 여기서는
 * 그 뒤의 계약을 본다: 목록이 그려지는가, 고르면 값이 바뀌고 input·change 가 둘 다 버블링되는가.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class El {
  tagName: string;
  className = ''; id = ''; value = ''; textContent = ''; label = ''; title = '';
  disabled = false; selected = false;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;

  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }

  set innerHTML(v: string) { if (v === '') { for (const c of this.children) c.parent = null; this.children = []; } }
  get innerHTML() { return ''; }

  appendChild(c: El) { c.parent = this; this.children.push(c); return c; }
  append(...cs: El[]) { for (const c of cs) this.appendChild(c); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  focus() { focused = this; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 10, bottom: 40, width: 180 }; }

  private hit(s: string) {
    return s.startsWith('.') ? this.className.split(' ').includes(s.slice(1)) : this.tagName === s.toUpperCase();
  }
  closest(s: string): El | null {
    for (let n: El | null = this; n; n = n.parent) if (n.hit(s)) return n;
    return null;
  }
  contains(n: El | null): boolean {
    for (let c = n; c; c = c.parent) if (c === this) return true;
    return false;
  }
  *walk(): Generator<El> { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(s: string): El | null {
    for (const c of this.walk()) if (c.hit(s)) return c;
    return null;
  }
  dispatchEvent(e: { type: string; target?: El }) { e.target = this; fire(e.type, e); return true; }
}

let focused: El | null = null;
const docListeners = new Map<string, Array<(e: unknown) => void>>();
const winListeners = new Map<string, Array<(e: unknown) => void>>();
const fire = (type: string, e: unknown) => { for (const fn of docListeners.get(type) ?? []) fn(e); };
const body = new El('body');

vi.stubGlobal('document', {
  body,
  createElement: (tag: string) => new El(tag),
  addEventListener: (t: string, fn: (e: unknown) => void) => docListeners.set(t, [...(docListeners.get(t) ?? []), fn]),
});
vi.stubGlobal('window', {
  addEventListener: (t: string, fn: (e: unknown) => void) => winListeners.set(t, [...(winListeners.get(t) ?? []), fn]),
});
vi.stubGlobal('scrollX', 0);
vi.stubGlobal('scrollY', 0);
vi.stubGlobal('Event', class { type: string; bubbles: boolean; target: El | null = null;
  constructor(type: string, o?: { bubbles?: boolean }) { this.type = type; this.bubbles = !!o?.bubbles; } });

const { closeSelectPop, enhanceSelects, setRowDelete } = await import('../src/gui/select.js');
enhanceSelects();

// select.js 가 body 에 붙인 팝업
const pop = body.children.find((c) => c.className === 'ac')!;
const mousedown = (target: El) => {
  let prevented = false;
  fire('mousedown', { target, preventDefault: () => { prevented = true; } });
  return prevented;
};

/** <select><option>… 픽스처 */
function makeSelect(id: string, opts: Array<[string, string, boolean?]>) {
  const sel = new El('select');
  sel.id = id;
  for (const [value, text, disabled] of opts) {
    const o = new El('option');
    o.value = value; o.textContent = text; o.disabled = !!disabled;
    sel.appendChild(o);
  }
  sel.children[0].selected = true;
  sel.value = opts[0][0];
  return sel;
}

let sel: El;
beforeEach(() => { closeSelectPop(); sel = makeSelect('oLocale', [['ko', '한국어'], ['en', 'English'], ['ja', '日本語']]); });

describe('열기', () => {
  it('네이티브 팝업을 막고(preventDefault) 포커스는 직접 준다', () => {
    expect(mousedown(sel)).toBe(true);
    expect(focused).toBe(sel);
  });

  it('옵션 개수만큼 행을 그리고 컨트롤 아래에 놓는다', () => {
    mousedown(sel);
    expect(pop.children.filter((c) => c.className.startsWith('ac-item'))).toHaveLength(3);
    expect(pop.style.display).toBe('block');
    expect(pop.style.top).toBe('44px'); // getBoundingClientRect().bottom(40) + 4
    expect(pop.style.left).toBe('10px');
  });

  it('현재 선택 항목에 .sel 이 붙는다', () => {
    mousedown(sel);
    expect(pop.querySelector('.sel')?.textContent).toBe('한국어');
  });

  it('같은 select 를 다시 누르면 닫힌다', () => {
    mousedown(sel);
    mousedown(sel);
    expect(pop.style.display).toBe('none');
  });

  it('바깥을 누르면 닫힌다', () => {
    mousedown(sel);
    mousedown(new El('div'));
    expect(pop.style.display).toBe('none');
  });
});

describe('optgroup', () => {
  it('그룹 라벨을 행 사이에 넣는다 — 모바일 teamSel 이 두 그룹으로 나뉜다', () => {
    const s = new El('select');
    const g = new El('optgroup');
    g.label = '기본 프리셋';
    const o = new El('option'); o.value = 'preset:users'; o.textContent = '사용자';
    g.appendChild(o);
    s.appendChild(g);
    mousedown(s);
    expect(pop.children.map((c) => c.className)).toEqual(['ac-group', 'ac-item']);
    expect(pop.children[0].textContent).toBe('기본 프리셋');
  });
});

describe('선택', () => {
  it('값이 바뀌고 input·change 가 둘 다 버블링된다', () => {
    const seen: string[] = [];
    for (const t of ['input', 'change']) {
      docListeners.set(t, [...(docListeners.get(t) ?? []), (e) => seen.push(t + ':' + (e as { target: El }).target.id)]);
    }
    mousedown(sel);
    const en = pop.children.find((c) => c.textContent === 'English')!;
    fire('mousedown', { target: en, preventDefault() {} });

    expect(sel.value).toBe('en');
    expect(seen).toEqual(['input:oLocale', 'change:oLocale']);
    expect(pop.style.display).toBe('none');
  });

  // 프리셋 삭제 ✕. 확인·삭제는 #delModal 쪽에 있고, 이 위젯이 지는 책임은 둘뿐이다:
  // 표시된 항목에만 ✕ 를 그리고, 눌리면 팝업을 닫고 (sid, label) 을 넘긴다
  describe('행별 삭제 ✕', () => {
    let asked: Array<[string, string]>;
    const teamSel = (sids: string[]) => {
      const s = new El('select');
      s.id = 'teamSel';
      const ph = new El('option'); ph.value = ''; ph.textContent = '저장된 프리셋…';
      s.appendChild(ph); // 플레이스홀더엔 표시가 없어 ✕ 도 없다
      for (const sid of sids) {
        const o = new El('option');
        o.value = sid; o.textContent = sid + ' (/api/users)'; o.dataset.del = sid;
        s.appendChild(o);
      }
      return s;
    };

    beforeEach(() => {
      asked = [];
      setRowDelete((sid: string, label: string) => { asked.push([sid, label]); }, '이 프리셋 삭제');
    });

    it('표시된 항목에만 ✕ 를 붙인다', () => {
      mousedown(teamSel(['ws1.aaaa', 'ws1.bbbb']));
      const xs = pop.children.map((r) => r.querySelector('.ac-x'));
      expect(xs[0]).toBe(null); // 플레이스홀더
      expect(xs[1]?.textContent).toBe('✕');
      expect(xs[1]?.title).toBe('이 프리셋 삭제'); // 주입한 문구가 버튼에 닿는다 (ko/en 짝은 부르는 쪽)
      expect(pop.children.filter((r) => r.querySelector('.ac-x')).length).toBe(2);
    });

    // 팝업은 z-index 30, 모달은 20 — 안 닫으면 확인창 위로 목록이 떠버린다
    it('✕ 를 누르면 팝업을 닫고 (sid, label) 을 넘긴다 — 값 선택으로 새지 않는다', () => {
      const s = teamSel(['ws1.aaaa', 'ws1.bbbb']);
      mousedown(s);
      expect(mousedown(pop.children[1].querySelector('.ac-x')!)).toBe(true); // preventDefault

      expect(asked).toEqual([['ws1.aaaa', 'ws1.aaaa (/api/users)']]);
      expect(pop.style.display).toBe('none');
      expect(s.value).toBe(''); // 행을 고른 게 아니다 (플레이스홀더 그대로)
    });
  });

  it('disabled 항목은 값을 바꾸지 않는다 — teamSel 의 "아직 없음" 안내', () => {
    const s = makeSelect('teamSel', [['', '저장된 프리셋…'], ['', '아직 없음 — 저장해보세요', true]]);
    mousedown(s);
    const note = pop.children.find((c) => c.textContent!.startsWith('아직 없음'))!;
    expect(note.attrs['aria-disabled']).toBe('true');
    expect(note.dataset.v).toBeUndefined();
    fire('mousedown', { target: note, preventDefault() {} });
    expect(pop.style.display).toBe('block'); // 닫히지도 않는다
  });
});
