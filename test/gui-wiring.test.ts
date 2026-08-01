/**
 * GUI 이벤트 배선 — 구독을 빠뜨려도 아무 일이 안 일어날 뿐 아무도 안 터진다.
 * 순환을 끊으려고 직접 호출을 이벤트로 바꾼 대가라, 그 자리를 여기서 막는다.
 *
 * 번들이 아니라 src/gui/main.js 를 그대로 태운다 (빌드 산출물과 무관, 스택 트레이스 정상).
 * DOM 스텁은 셀렉터별로 같은 객체를 돌려줘야 텍스트 변화를 관찰할 수 있다.
 */
import { describe, expect, it, vi } from 'vitest';

const el = () => ({
  style: {} as Record<string, string>, dataset: {} as Record<string, string>,
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  children: [] as unknown[], value: '', textContent: '', innerHTML: '', title: '', open: false,
  appendChild() {}, append() {}, remove() {}, focus() {}, setAttribute() {},
  hasAttribute: () => false, addEventListener() {},
  querySelector: () => el(), querySelectorAll: () => [], closest: () => el(),
  getBoundingClientRect: () => ({ left: 0, bottom: 0, width: 100 }),
});

const nodes = new Map<string, ReturnType<typeof el>>();
const pick = (sel: string) => {
  if (!nodes.has(sel)) nodes.set(sel, el());
  return nodes.get(sel)!;
};

const fetched: string[] = [];
const replaced: string[] = [];
const listeners = new Map<string, Array<(e: unknown) => void>>();

vi.stubGlobal('document', {
  documentElement: el(), body: el(),
  querySelector: pick, querySelectorAll: () => [], createElement: () => el(),
  addEventListener: (type: string, fn: (e: unknown) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  },
  dispatchEvent: (e: { type: string }) => {
    for (const fn of listeners.get(e.type) ?? []) fn(e);
    return true;
  },
});
vi.stubGlobal('location', { hash: '', search: '', origin: 'https://mock.test', href: 'https://mock.test/' });
vi.stubGlobal('navigator', { language: 'ko-KR' });
vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, scrollY: 0 });
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
vi.stubGlobal('history', { replaceState: (_a: unknown, _b: unknown, url: string) => replaced.push(url) });
vi.stubGlobal('performance', { now: () => 0 });
vi.stubGlobal('MutationObserver', class { observe() {} });
vi.stubGlobal('fetch', async (url: string) => {
  fetched.push(url);
  return {
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ fakerPaths: [], dslTypes: [], items: [] }),
    text: async () => '{}',
  };
});

// 스텁이 선 뒤에 모듈 그래프를 평가해야 한다 — 정적 import 는 호이스팅돼서 못 쓴다
await import('../src/gui/main.js');
await new Promise((r) => setTimeout(r, 20)); // 초기화 IIFE 의 await 통과 대기

// tsconfig 의 lib 에 DOM 이 없다 (워커용) — 스텁은 globalThis 를 통해 집는다
const emit = (name: string) =>
  (globalThis as unknown as { document: { dispatchEvent(e: { type: string }): void } }).document.dispatchEvent({ type: name });

describe('초기화', () => {
  it('타입 목록과 저장 목록을 받아온다', () => {
    expect(fetched.some((u) => u.startsWith('/schema/types'))).toBe(true);
    expect(fetched.some((u) => u.startsWith('/schema/saved'))).toBe(true);
  });

  it('첫 렌더에서 주소창을 동기화한다', () => {
    expect(replaced.length).toBeGreaterThan(0);
    expect(replaced.at(-1)).toContain('_res=');
  });
});

describe('이벤트 배선', () => {
  it('schema:changed → preview 가 주소창을 다시 쓴다', () => {
    const before = replaced.length;
    emit('schema:changed');
    expect(replaced.length).toBeGreaterThan(before);
  });

  it('ws:changed → save 가 저장 목록을 다시 부른다', () => {
    const before = fetched.filter((u) => u.startsWith('/schema/saved')).length;
    emit('ws:changed');
    expect(fetched.filter((u) => u.startsWith('/schema/saved')).length).toBeGreaterThan(before);
  });

  it('team:ready → workspace 가 워크스페이스 UI 를 갱신한다', () => {
    pick('#wsBtnLabel').textContent = '';
    emit('team:ready');
    expect(pick('#wsBtnLabel').textContent).not.toBe('');
  });

  it('아무도 구독하지 않는 이벤트는 조용히 무시된다', () => {
    expect(() => emit('nobody:listens')).not.toThrow();
  });

  // 메서드 버튼은 숨은 #oMethod 를 거쳐 URL 로만 드러난다 — 배선이 끊겨도 화면은 멀쩡해 보인다
  it('메서드 버튼 클릭 → 주소창에 _method 반영', () => {
    const btn = { ...el(), dataset: { method: 'post' } };
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'click',
      target: { ...el(), closest: () => btn },
    });
    expect(pick('#oMethod').value).toBe('post');
    expect(replaced.at(-1)).toContain('_method=post');
  });
});
