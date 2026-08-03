/**
 * @vitest-environment jsdom
 *
 * "URL 이 곧 GUI 상태" 왕복 — CLAUDE.md 불변식 4번.
 * localStorage 를 안 쓰기로 한 대가라, 이 왕복이 깨지면 새로고침에 사용자 스키마가 증발한다.
 *
 * 스텁 DOM 이 아니라 src/gui/index.html 마크업을 그대로 태운다. 스텁은 통과하도록 빚게 되어
 * 실제 id 가 어긋나도 초록불이 뜨지만, 진짜 마크업은 #oTotal·.okey[data-for] 가 사라지면 터진다.
 * index.html 은 //__JS__ 마커 자리라 스크립트가 없어 (JSON-LD 뿐) 파싱만으로 충분하다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import MARKUP from '../src/gui/index.html';

// tsconfig 의 lib 에 DOM 이 없다 — 워커 코드가 document·localStorage 를 보면 안 되기 때문이다.
// 전역 lib 을 넓히는 대신 이 파일이 실제로 만지는 멤버만 좁게 선언한다.
interface Input { value: string }
declare const document: {
  documentElement: { innerHTML: string };
  querySelector(s: string): Input | null;
  querySelectorAll(s: string): { length: number };
};
declare const history: { replaceState(a: unknown, b: string, c: string): void };

// dom.js 가 로드 시점에 $('#fields') 를 잡아 들고 있다 — 마크업이 먼저 서야 하고,
// 한 번 선 뒤에는 교체하면 안 된다 (교체하면 fieldsEl 이 떨어져 나간 옛 노드를 가리킨다).
document.documentElement.innerHTML = MARKUP;
const { OPT_DEFAULTS, OPT_INPUTS, buildQuery, loadFromAddressBar, readState, setOptKeys } =
  await import('../src/gui/url-state.js');

type State = { res: string; fields: [string, string][]; opts: Record<string, string> };

const $ = (sel: string): Input => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('마크업에 없는 셀렉터: ' + sel);
  return el;
};

/** state → 주소창 쿼리 → DOM → state. 중간을 안 믿고 양 끝만 비교한다 */
function roundTrip(state: State): State {
  const q = '_res=' + encodeURIComponent(state.res) + '&' + buildQuery(state);
  history.replaceState(null, '', '/?' + q);
  expect(loadFromAddressBar(), '주소창 파싱 자체가 실패').toBe(true);
  return readState() as State;
}

beforeEach(() => {
  // loadFromAddressBar 는 URL 에 있는 옵션만 덮어쓴다 — 지난 케이스 값이 남지 않게 되돌린다
  for (const [k, sel] of Object.entries(OPT_INPUTS)) {
    $(sel as string).value = OPT_DEFAULTS[k as keyof typeof OPT_DEFAULTS];
  }
  setOptKeys(null);
});

describe('URL ↔ GUI 상태 왕복', () => {
  it('필드 + 옵션이 그대로 돌아온다', () => {
    const state: State = {
      res: 'users',
      fields: [['id', 'uuid'], ['name', 'person.fullName'], ['age', 'int:20~60']],
      opts: { _total: '500', _limit: '20' },
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('중첩·배열·nullable·가중치 enum 도 원문 그대로', () => {
    const state: State = {
      res: 'orders/1024',
      fields: [
        ['address.city', 'location.city'],
        ['tags[]', 'lorem.word:3'],
        ['email', 'internet.email?0.2'],
        ['status', 'enum:paid*8|refund*2'],
      ],
      opts: { _wrap: 'one', _seed: '1024' },
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('pattern 의 # 처럼 인코딩이 필요한 값도 살아 돌아온다', () => {
    const state: State = {
      res: 'products',
      fields: [['sku', 'pattern:PRD-####-??'], ['name', 'commerce.productName']],
      opts: {},
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('기본값과 같은 옵션은 URL 에 안 실리고 상태에도 안 남는다', () => {
    const back = roundTrip({ res: 'items', fields: [['id', 'uuid']], opts: { _limit: '10' } });
    expect(back.opts).toEqual({}); // _limit=10 은 기본값
  });

  it('_alias 로 예약어 이름을 바꿔도 왕복이 유지된다', () => {
    $('.okey[data-for="_page"]').value = 'page';
    $('.okey[data-for="_limit"]').value = 'size';
    const state: State = { res: 'users', fields: [['id', 'uuid']], opts: { _page: '3', _limit: '50' } };

    const q = '_res=users&' + buildQuery(state);
    expect(q, '별칭이 쿼리 키로 나가야 한다').toContain('page=3');
    expect(q).toContain('size=50');

    history.replaceState(null, '', '/?' + q);
    expect(loadFromAddressBar()).toBe(true);
    // 별칭은 표기일 뿐 — 되읽은 상태는 예약어 이름으로 정규화된다
    expect(readState()).toEqual(state);
  });

  it('필드가 없으면 빈 행 하나를 세워 화면이 비지 않게 한다', () => {
    const back = roundTrip({ res: 'items', fields: [], opts: {} });
    expect(back.fields).toEqual([]); // 빈 행은 이름·값이 비어 상태에는 안 잡힌다
    expect(document.querySelectorAll('#fields .frow').length).toBe(1);
  });
});
