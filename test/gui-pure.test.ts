/**
 * GUI 순수 함수 — src/gui/pure.js.
 * GUI 의 나머지 모듈은 최상위에서 document·location·matchMedia 를 읽어 Node 에서 import 만으로
 * 터진다. 그래서 DOM 없이 검증 가능한 것은 pure.js 로 모아두고, 여기서만 테스트한다.
 */
import { describe, expect, it } from 'vitest';
import { buildQuery, enc, encPath, highlightJson, minifyJson, parseAliasParam, parseCsv, parseWsInput } from '../src/gui/pure.js';

describe('enc — 읽기 좋은 URL', () => {
  it('DSL 문법 문자는 되살린다', () => {
    expect(enc('int:20~60')).toBe('int:20~60');
    expect(enc('enum:admin|user')).toBe('enum:admin|user');
    expect(enc('tags[]')).toBe('tags[]');
    expect(enc('a,b')).toBe('a,b');
  });

  it('# 은 인코딩한다 — 살려두면 URL 프래그먼트가 된다', () => {
    expect(enc('pattern:ORD-####')).toBe('pattern:ORD-%23%23%23%23');
  });

  it('공백·앰퍼샌드는 인코딩', () => {
    expect(enc('a b')).toBe('a%20b');
    expect(enc('a&b')).toBe('a%26b');
  });
});

describe('encPath — 리소스 경로', () => {
  it('다단계 경로의 슬래시는 유지', () => {
    expect(encPath('v2/users/123/orders')).toBe('v2/users/123/orders');
  });

  it('앞뒤·중복 슬래시는 제거', () => {
    expect(encPath('/orders//1024/')).toBe('orders/1024');
  });

  it('세그먼트는 각각 인코딩', () => {
    expect(encPath('사용자/1')).toBe('%EC%82%AC%EC%9A%A9%EC%9E%90/1');
  });
});

describe('buildQuery — 스키마 상태 → 쿼리스트링', () => {
  const state = {
    res: 'users',
    fields: [['name', 'person.fullName'], ['tags[]', 'lorem.word:3']] as [string, string][],
    opts: { _total: '500', _limit: '20' } as Record<string, string>,
  };

  it('필드와 옵션을 순서대로 잇는다', () => {
    expect(buildQuery(state, {})).toBe('name=person.fullName&tags[]=lorem.word:3&_total=500&_limit=20');
  });

  it('별칭이 있으면 예약어를 바꾸고 _alias 선언을 덧붙인다', () => {
    expect(buildQuery(state, { _limit: 'size' }))
      .toBe('name=person.fullName&tags[]=lorem.word:3&_total=500&size=20&_alias=size:_limit');
  });

  it('값이 없는 별칭도 선언은 남는다 — _s 저장 후 앱이 넘기는 시나리오', () => {
    expect(buildQuery({ res: 'u', fields: [], opts: {} }, { _q: 'keyword' })).toBe('_alias=keyword:_q');
  });

  it('빈 상태는 빈 문자열', () => {
    expect(buildQuery({ res: 'u', fields: [], opts: {} }, {})).toBe('');
  });

  // _method 는 기본값(get)이면 readState 가 안 싣는다 — GET URL 이 예전과 바이트 동일해야 하므로.
  // (API URL 에서 _method 를 빼는 것은 url-state.apiQuery 의 몫 — buildQuery 자체는 그대로 싣는다)
  it('_method/_body 를 싣는다 — JSON 은 퍼센트 인코딩', () => {
    const q = buildQuery({ res: 'u', fields: [['id', 'uuid']], opts: { _method: 'post' } }, {});
    expect(q).toBe('id=uuid&_method=post');
    const f = buildQuery({ res: 'u', fields: [['id', 'uuid']], opts: { _status: '401', _body: '{"code":"E_AUTH"}' } }, {});
    expect(f).toBe('id=uuid&_status=401&_body=%7B%22code%22:%22E_AUTH%22%7D'); // enc 는 ':' 를 살려둔다
  });
});

describe('minifyJson — 화면은 정렬형, URL 은 압축형', () => {
  it('정렬된 JSON 을 한 줄로 — URL 에 %0A%20%20 이 안 끼게', () => {
    expect(minifyJson('{\n  "code": "E_AUTH",\n  "n": 1\n}')).toBe('{"code":"E_AUTH","n":1}');
  });

  it('깨진 JSON 은 원본 그대로 — 서버가 400 으로 알려주는 게 낫다', () => {
    expect(minifyJson('{nope}')).toBe('{nope}');
    expect(minifyJson('')).toBe('');
  });

  it('객체가 아니어도 통과 (배열·문자열)', () => {
    expect(minifyJson('[ 1, 2 ]')).toBe('[1,2]');
  });
});

describe('parseAliasParam — _alias 파싱', () => {
  const parse = (q: string) => parseAliasParam(new URLSearchParams(q));

  it('양방향 맵을 만든다', () => {
    expect(parse('_alias=page:_page,size:_limit')).toStrictEqual({
      rev: { page: '_page', size: '_limit' },
      byDef: { _page: 'page', _limit: 'size' },
    });
  });

  it('_alias 가 없으면 빈 맵', () => {
    expect(parse('name=person.fullName')).toStrictEqual({ rev: {}, byDef: {} });
  });

  it('콜론이 맨 앞이면 별칭이 비어 무시 — 예약어를 통째로 삼키지 않는다', () => {
    expect(parse('_alias=:_page,size:_limit')).toStrictEqual({
      rev: { size: '_limit' },
      byDef: { _limit: 'size' },
    });
  });

  it('콜론이 없는 항목은 무시', () => {
    expect(parse('_alias=page')).toStrictEqual({ rev: {}, byDef: {} });
  });
});

describe('parseWsInput — 워크스페이스 ID 추출', () => {
  const BASE = 'https://mock.test';

  it('순수 ID', () => {
    expect(parseWsInput('abc123def')).toBe('abc123def');
  });

  it('_ws= 가 있는 공유 링크', () => {
    expect(parseWsInput('https://mock.test/?_ws=abc123def', BASE)).toBe('abc123def');
  });

  it('sid(ws.id) 는 앞부분만', () => {
    expect(parseWsInput('abc123def.4f2a1b')).toBe('abc123def');
  });

  it('_s= 짧은 URL 에서도 워크스페이스를 뽑는다', () => {
    expect(parseWsInput('https://mock.test/api/users?_s=abc123def.4f2a1b', BASE)).toBe('abc123def');
  });

  it('_ws 도 _s 도 없는 링크는 null', () => {
    expect(parseWsInput('https://mock.test/api/users?name=uuid', BASE)).toBeNull();
  });

  it('형식이 어긋나면 null', () => {
    expect(parseWsInput('ABC123DEF')).toBeNull(); // 대문자
    expect(parseWsInput('short')).toBeNull(); // 6자 미만
    expect(parseWsInput('a'.repeat(25))).toBeNull(); // 24자 초과
    expect(parseWsInput('')).toBeNull();
    expect(parseWsInput(null as unknown as string)).toBeNull();
  });
});

describe('parseCsv — RFC 4180', () => {
  it('CRLF 로 끝나는 행을 파싱', () => {
    expect(parseCsv('a,b\r\nx,y\r\n')).toStrictEqual([['a', 'b'], ['x', 'y']]);
  });

  it('따옴표 안의 쉼표는 구분자가 아니다', () => {
    expect(parseCsv('name,city\r\n"김,민준",서울\r\n')).toStrictEqual([['name', 'city'], ['김,민준', '서울']]);
  });

  it('두 겹 따옴표는 리터럴 따옴표', () => {
    expect(parseCsv('a\r\n"he said ""hi"""\r\n')).toStrictEqual([['a'], ['he said "hi"']]);
  });

  it('따옴표 안의 개행은 같은 셀', () => {
    expect(parseCsv('a,b\r\n"1\n2",y\r\n')).toStrictEqual([['a', 'b'], ['1\n2', 'y']]);
  });

  it('마지막 줄에 개행이 없어도 마지막 행을 잃지 않는다', () => {
    expect(parseCsv('a,b\r\nx,y')).toStrictEqual([['a', 'b'], ['x', 'y']]);
  });
});

describe('highlightJson', () => {
  it('키·문자열·숫자·키워드에 클래스를 붙인다', () => {
    const html = highlightJson('{"a": 1, "b": "x", "c": true, "d": null}');
    expect(html).toContain('<span class="j-key">"a"</span>');
    expect(html).toContain('<span class="j-num">1</span>');
    expect(html).toContain('<span class="j-str">"x"</span>');
    expect(html).toContain('<span class="j-kw">true</span>');
    expect(html).toContain('<span class="j-kw">null</span>');
  });

  it('값 안의 HTML 은 이스케이프한다 — innerHTML 로 들어가는 문자열', () => {
    expect(highlightJson('{"a": "<img src=x onerror=alert(1)>"}')).not.toContain('<img');
    expect(highlightJson('{"a": "<b>"}')).toContain('&lt;b&gt;');
  });

  it('음수·지수 표기도 숫자로 본다', () => {
    expect(highlightJson('[-1.5e10]')).toContain('<span class="j-num">-1.5e10</span>');
  });
});
