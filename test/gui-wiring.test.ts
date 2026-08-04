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
  hasAttribute: () => false, addEventListener() {}, contains: () => true,
  querySelector: () => el(), querySelectorAll: () => [], closest: () => el(),
  getBoundingClientRect: () => ({ left: 0, bottom: 0, width: 100 }),
});

const nodes = new Map<string, ReturnType<typeof el>>();
const pick = (sel: string) => {
  if (!nodes.has(sel)) nodes.set(sel, el());
  return nodes.get(sel)!;
};

const SAVED_SID = 'wsabc123.ab12cd34ef';
const fetched: string[] = [];
const calls: Array<{ url: string; method: string; body?: string }> = [];
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
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  fetched.push(url);
  calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
  return {
    ok: true, status: 200, headers: { get: () => 'application/json' },
    // sid 는 /schema/save 응답용 (저장 후 shared.loadedPreset 이 이걸 물고 간다)
    json: async () => ({ fakerPaths: [], dslTypes: [], items: [], sid: SAVED_SID }),
    text: async () => '{}',
  };
});

// 스텁이 선 뒤에 모듈 그래프를 평가해야 한다 — 정적 import 는 호이스팅돼서 못 쓴다
await import('../src/gui/main.js');
const { shared } = await import('../src/gui/shared.js');
const { acceptGhost, paintBody } = await import('../src/gui/url-state.js');
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

  // 자동 정렬은 포커스가 없을 때만 돌아 손으로 친 JSON 을 놓친다 — 버튼이 그 자리를 메운다
  it('{ } 정렬 버튼 클릭 → 실패 바디가 2칸 들여쓰기로', () => {
    pick('#oBody').value = '{"code":"E_AUTH"}';
    const btn = { ...el(), id: 'oBodyFmt' };
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'click',
      target: { ...el(), closest: () => btn },
    });
    expect(pick('#oBody').value).toBe('{\n  "code": "E_AUTH"\n}');
  });

  // 고스트는 미리보기 응답에서 오고 Tab 이 확정한다. keydown 배선 자체는 스텁의
  // addEventListener 가 no-op 이라 못 덮으므로, 값이 정해지는 쪽(paintBody→acceptGhost)만 본다
  it('빈 칸 + 400 이상 → 고스트를 Tab 으로 확정, 200번대면 고스트 없음', () => {
    shared.lastPreviewText = '{\n  "error": "Not Found",\n  "status": 404\n}';
    pick('#oBody').value = '';

    pick('#oStatus').value = '200';
    paintBody();
    expect(acceptGhost()).toBe(false); // 미리보기가 성공 데이터다
    expect(pick('#oBody').value).toBe('');

    pick('#oStatus').value = '404';
    paintBody();
    expect(acceptGhost()).toBe(true);
    expect(pick('#oBody').value).toBe(shared.lastPreviewText);
  });

  it('미리보기가 아직 이전 상태코드의 응답이면 고스트를 만들지 않는다', () => {
    shared.lastPreviewText = '{\n  "error": "Not Found",\n  "status": 404\n}';
    pick('#oBody').value = '';
    pick('#oStatus').value = '500'; // 방금 바꿨고 미리보기(300ms 디바운스)는 아직 404 응답
    paintBody();
    expect(acceptGhost()).toBe(false);
  });

  it('성공 응답(envelope)은 고스트가 되지 않는다', () => {
    shared.lastPreviewText = '{\n  "data": [],\n  "page": 1\n}';
    pick('#oBody').value = '';
    pick('#oStatus').value = '404';
    paintBody();
    expect(acceptGhost()).toBe(false);
  });

  it('미리보기가 JSON 이 아니면(요청 실패) 고스트를 만들지 않는다', () => {
    shared.lastPreviewText = 'TypeError: Failed to fetch';
    pick('#oBody').value = '';
    pick('#oStatus').value = '500';
    paintBody();
    expect(acceptGhost()).toBe(false);
  });

  // 모달 7개의 닫기가 전부 closeModal 하나라 코너 ✕ 도 data-close 분기 하나로 덮는다
  it('모달 코너 ✕ 클릭 → 해당 모달만 닫힌다', () => {
    pick('#newsModal').style.display = 'flex';
    pick('#helpModal').style.display = 'flex';
    const btn = { ...el(), dataset: { close: 'newsModal' } };
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'click',
      target: { ...el(), closest: () => btn },
    });
    expect(pick('#newsModal').style.display).toBe('none');
    expect(pick('#helpModal').style.display).toBe('flex');
  });

  it('아무도 구독하지 않는 이벤트는 조용히 무시된다', () => {
    expect(() => emit('nobody:listens')).not.toThrow();
  });

  // 메서드 버튼은 숨은 #oMethod 를 거쳐 드러난다 — 배선이 끊겨도 화면은 멀쩡해 보인다.
  // 이번 변경의 계약 3개를 한 번에: 주소창엔 남고, API URL 엔 없고, 진짜 그 verb 로 나간다
  it('메서드 버튼 클릭 → 주소창엔 _method, API 요청엔 진짜 POST', async () => {
    const btn = { ...el(), dataset: { method: 'post' } };
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'click',
      target: { ...el(), closest: () => btn },
    });
    expect(pick('#oMethod').value).toBe('post');
    expect(replaced.at(-1)).toContain('_method=post'); // 주소창 = GUI 상태

    await new Promise((r) => setTimeout(r, 360)); // 미리보기 디바운스 300ms
    const api = calls.filter((c) => c.url.includes('/api/')).at(-1)!;
    expect(api.method).toBe('POST');
    expect(api.url).not.toContain('_method'); // API URL 은 메서드 중립
  });
});

// 프리셋 삭제: 드롭다운 행의 ✕(select.js) → #delModal 확인 → DELETE(save.js).
// 세 파일에 걸친 배선이라 한 군데만 끊겨도 조용히 죽는다
describe('프리셋 삭제 (드롭다운 ✕ → 확인 모달)', () => {
  const clickX = (sid: string, label: string) =>
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'mousedown',
      preventDefault() {},
      // ✕ 는 .ac-item 안에 있어 둘 다 매치된다 — 핸들러가 .ac-x 를 먼저 보는지까지 확인하는 셈
      target: { ...el(), closest: (s: string) => (s === '.ac-x' || s === '.ac-item' ? { ...el(), dataset: { sid, label } } : null) },
    });
  const clickBtn = (id: string) =>
    (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document.dispatchEvent({
      type: 'click',
      target: { ...el(), closest: () => ({ ...el(), id }) },
    });
  const delCalls = () => calls.filter((c) => c.method === 'DELETE');
  const load = () => {
    shared.ws = 'wsabc123';
    shared.loadedPreset = { sid: SAVED_SID, res: 'users', query: 'name=person.fullName', name: '사용자' };
  };

  it('✕ → 확인 모달이 이름과 함께 열리고, 아직 요청은 없다', () => {
    load();
    const before = delCalls().length;
    clickX(SAVED_SID, '사용자 (/api/users)');
    expect(pick('#delModal').style.display).toBe('flex');
    expect(pick('#delTarget').textContent).toBe('사용자 (/api/users)');
    expect(delCalls().length).toBe(before); // 확인 전에는 안 지운다
  });

  it('[삭제] → DELETE + 불러온 프리셋 해제 + 모달 닫힘', async () => {
    load();
    clickX(SAVED_SID, '사용자 (/api/users)');
    clickBtn('delApply');
    await new Promise((r) => setTimeout(r, 5));
    expect(delCalls().at(-1)!.url).toBe('/schema/saved/' + SAVED_SID);
    expect(shared.loadedPreset).toBe(null); // 지운 게 편집 중이던 프리셋이면 해제
    expect(pick('#delModal').style.display).toBe('none');
  });

  it('[취소] → 요청 없이 닫힌다', async () => {
    load();
    clickX(SAVED_SID, '사용자 (/api/users)');
    const before = delCalls().length;
    clickBtn('delCancel');
    await new Promise((r) => setTimeout(r, 5));
    expect(delCalls().length).toBe(before);
    expect(pick('#delModal').style.display).toBe('none');
    expect(shared.loadedPreset).not.toBe(null);
  });
});
