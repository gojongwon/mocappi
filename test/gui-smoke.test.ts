/**
 * GUI 부팅 스모크 — 빌드 산출물(gui.generated.html)을 jsdom 에서 실제로 실행한다.
 *
 * gui-pure/gui-wiring 이 순수 함수와 구독 존재만 보는 것과 달리, 여기는 서빙되는
 * HTML 그대로 부팅해 "초기 렌더 → schema:changed → 미리보기/주소창 갱신 → 클릭"
 * 의 실배선을 검증한다 — 배선을 빠뜨리면 조용히 통과하던 구멍을 막는 층.
 * (jsdom 이라 레이아웃·CSS 는 못 본다 — 그건 npm run dev 육안 확인의 몫)
 */
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import html from '../src/gui.generated.html';

/** 워커 응답 흉내 — GUI 가 쓰는 것(ok/status/headers.get/json/text)만 */
function fakeResponse(body: unknown, contentType = 'application/json') {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

const TYPES = {
  reserved: [],
  dslTypes: [{ type: 'int', syntax: 'int:min~max', example: 'int:20~60', label: '정수 범위' }],
  fakerPaths: [{ value: 'person.fullName', label: '이름(전체)' }],
};
const ENVELOPE = { data: [{ id: 'x', name: '김민준' }], page: 1, limit: 20, total: 500, totalPages: 25, hasNext: true, hasPrev: false };
const SID = 'wsabc123.ab12cd34ef'; // 워크스페이스 프리셋 — 상태 자격
const SAVED = { sid: SID, id: 'ab12cd34ef', ws: 'wsabc123', name: '상태', res: 'users', query: 'id=uuid&name=person.fullName&_total=20', createdAt: '' };

/** 부팅된 창 + 가로챈 fetch 호출 목록 */
function boot(url: string): { window: SmokeWindow; calls: string[] } {
  const calls: string[] = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true, // requestAnimationFrame 등 — 브라우저 흉내
    beforeParse(window) {
      // jsdom 에 없는 matchMedia — 모바일 분기는 항상 데스크톱(false)으로
      window.matchMedia = (media: string) => ({
        matches: false, media, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent: () => false,
      });
      window.fetch = (input: unknown) => {
        const u = String(input);
        calls.push(u);
        if (u.includes('/schema/types')) return Promise.resolve(fakeResponse(TYPES));
        if (u.includes('/schema/saved/')) return Promise.resolve(fakeResponse(SAVED)); // 개별 조회 — 목록보다 먼저
        if (u.includes('/schema/saved')) return Promise.resolve(fakeResponse({ ws: null, items: [SAVED] }));
        if (u.includes('/api/')) return Promise.resolve(fakeResponse(ENVELOPE));
        return Promise.resolve(fakeResponse({}));
      };
    },
  });
  return { window: dom.window, calls };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const need = (el: SmokeEl | null, sel: string): SmokeEl => {
  if (!el) throw new Error('마크업에 없는 셀렉터: ' + sel);
  return el;
};

describe('부팅 (한국어, 맨 주소)', () => {
  let window: SmokeWindow;
  let calls: string[];
  let $: (sel: string) => SmokeEl;

  beforeAll(async () => {
    ({ window, calls } = boot('https://mocappi.test/#ko'));
    $ = (sel) => need(window.document.querySelector(sel), sel);
    await sleep(500); // 초기화(async IIFE) + 미리보기 디바운스 300ms
  });

  it('users 프리셋 행들이 렌더되고 웰컴 배너가 뜬다', () => {
    expect(window.document.querySelectorAll('.frow').length).toBe(10);
    expect($('#welcome').style.display).toBe('block');
    expect($('#resource').value).toBe('users');
  });

  it('schema:changed → 주소창에 /api/users URL', () => {
    const a = need($('#urlBox').querySelector('a'), '#urlBox a');
    expect(a.href).toContain('/api/users?');
    expect(a.href).toContain('name=person.fullName');
  });

  it('미리보기가 실제 fetch 를 보내고 응답을 그린다', () => {
    expect(calls.some((u) => u.includes('/api/users?'))).toBe(true);
    expect($('#preview').textContent).toContain('김민준');
    expect($('#statusLine').textContent).toContain('200');
  });

  it('+ 필드 추가 클릭 → 행이 하나 늘어난다 (클릭 위임 배선)', () => {
    const before = window.document.querySelectorAll('.frow').length;
    $('#addField').click();
    expect(window.document.querySelectorAll('.frow').length).toBe(before + 1);
  });

  it('필드 값 입력 → 주소창이 즉시 갱신된다 (input 위임 배선)', () => {
    const input = $('.frow .fname');
    input.value = 'nickname';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect($('#urlBox').textContent).toContain('nickname=');
  });

  it('프리셋 버튼 클릭 → 리소스·필드가 통째로 바뀐다', () => {
    $('button[data-preset="products"]').click();
    expect($('#resource').value).toBe('products');
    expect($('#urlBox').textContent).toContain('/api/products?');
  });

  it('팀 프리셋 로드 → 미리보기가 _s= 짧은 URL 로 요청하고 상태 패널이 나타난다', async () => {
    // v1.1.1 실사용 회귀: 미리보기가 전체 쿼리 URL(무상태)로 나가면
    // 상태 패널로 쓴 변화가 목록에 안 보인다 — _s= 경로만 상태를 얹는다
    const sel = $('#teamSel');
    sel.value = SID;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(500); // loadTeamPreset fetch + 미리보기 디바운스 300ms
    expect(calls.some((u) => u.includes('/api/users') && u.includes('_s=' + SID))).toBe(true);
    expect($('#stateBar').style.display).toBe('block');
  });
});

describe('부팅 (영어 해시)', () => {
  it('#en 이면 EN 사전이 적용된다', async () => {
    const { window } = boot('https://mocappi.test/#en');
    await sleep(50); // applyEn 은 동기 — 파싱 직후면 충분
    expect(window.document.documentElement.lang).toBe('en');
    expect(need(window.document.querySelector('#addField'), '#addField').textContent).toBe('+ Add field');
    expect(need(window.document.querySelector('#newsBtn span[data-i18n="newsLabel"]'), 'newsLabel').textContent).toContain("What's new");
  });
});
