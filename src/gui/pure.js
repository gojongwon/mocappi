/**
 * DOM·전역에 손대지 않는 함수들 — 여기 있는 것만 Node 에서 그대로 테스트할 수 있다.
 *
 * 나머지 모듈은 최상위에서 document·location·matchMedia 를 건드리므로 import 만 해도
 * Node 에서 터진다. 그 경계를 흐리지 않도록, 순수한 것은 이 파일 밖으로 나가지 않게 유지할 것.
 */

// ---- 인코딩: 읽기 좋은 URL 을 위해 안전 문자는 되살린다 ----
export const enc = (s) => encodeURIComponent(s)
  .replace(/%3A/gi, ':').replace(/%7E/gi, '~').replace(/%7C/gi, '|')
  .replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%2C/gi, ',');

export function encPath(res) {
  return res.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/**
 * 스키마 상태 → 쿼리스트링.
 * alias 는 { 예약어: 별칭 } — 화면의 옵션 키 입력칸에서 읽어 넘긴다 (url-state.js 의 래퍼).
 */
export function buildQuery(state, alias) {
  const parts = [];
  for (const [n, v] of state.fields) parts.push(enc(n) + '=' + enc(v));
  for (const [k, v] of Object.entries(state.opts)) parts.push((alias[k] || k) + '=' + enc(v));
  // 값이 없어도 별칭 선언은 유지 — _s 저장 후 앱이 keyword=... 처럼 넘기는 시나리오
  const pairs = Object.entries(alias).map(([def, a]) => a + ':' + def);
  if (pairs.length) parts.push('_alias=' + enc(pairs.join(',')));
  return parts.join('&');
}

/** URL 의 _alias 파라미터 파싱 → { rev: 별칭→예약어, byDef: 예약어→별칭 } */
export function parseAliasParam(params) {
  const rev = {}; const byDef = {};
  const raw = params.get('_alias');
  if (raw) {
    for (const ent of raw.split(',')) {
      const i = ent.indexOf(':');
      if (i > 0) {
        const a = ent.slice(0, i).trim(); const d = ent.slice(i + 1).trim();
        if (a && d) { rev[a] = d; byDef[d] = a; }
      }
    }
  }
  return { rev, byDef };
}

/**
 * 붙여넣은 값에서 워크스페이스 ID 추출 — 순수 ID / 링크(_ws=) / sid(ws.id) 모두 허용.
 * base 는 상대 링크를 풀 때만 쓰이며, 생략하면 그 시점에 location.origin 을 읽는다
 * (인자 없이 호출해도 ID·sid 경로는 location 을 건드리지 않는다).
 */
export function parseWsInput(raw, base) {
  raw = (raw || '').trim();
  if (!raw) return null;
  try {
    if (raw.includes('://') || raw.includes('?')) {
      const u = new URL(raw, base ?? location.origin);
      const fromWs = u.searchParams.get('_ws');
      if (fromWs && /^[a-z0-9]{6,24}$/.test(fromWs)) return fromWs;
      const fromSid = u.searchParams.get('_s');
      if (fromSid && fromSid.includes('.')) raw = fromSid;
      else return null;
    }
  } catch { return null; }
  const dot = raw.indexOf('.');
  if (dot > 0) raw = raw.slice(0, dot); // sid(ws.id) → ws 부분
  return /^[a-z0-9]{6,24}$/.test(raw) ? raw : null;
}

/**
 * 화면엔 정렬형, URL 엔 압축형 — 같은 JSON 의 두 렌더링일 뿐이다.
 * (정렬형을 그대로 실으면 URL 에 %0A%20%20 이 잔뜩 낀다)
 * 파싱이 안 되면 사용자가 친 그대로 둔다 — 서버가 400 으로 알려주는 게 낫다.
 */
export function minifyJson(s) {
  try { return JSON.stringify(JSON.parse(s)); } catch { return s; }
}

/**
 * 위의 반대 방향 — 화면용 2칸 들여쓰기.
 * 파싱 실패는 null 로 명시한다 ("정렬 못 했다"를 버튼이 알아야 오류를 띄운다).
 * 빈 칸은 오류가 아니라 그냥 빈 칸이다.
 */
export function prettyJson(s) {
  if (!s.trim()) return '';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return null; }
}

// ---- JSON 구문 하이라이팅 ----
export function highlightJson(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon, kw) => {
      if (str) return colon ? '<span class="j-key">' + str + '</span>' + colon : '<span class="j-str">' + str + '</span>';
      if (kw) return '<span class="j-kw">' + kw + '</span>';
      return '<span class="j-num">' + m + '</span>';
    },
  );
}

// CSV — RFC 4180 파싱
export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
