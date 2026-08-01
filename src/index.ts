/**
 * 라우터: GET / (GUI), GET|POST|PUT|PATCH|DELETE /api/:resource, /schema/* (types·infer·ts·save·saved)
 * 의존성 없이 URL.pathname 분기.
 */
import guiHtml from './gui.generated.html';
import { parseQuery, type ParsedQuery } from './dsl';
import { baseSeedOf, csvHeader, csvRow, generateItem, generateResponse, searchMatches } from './generate';
import { inferSchema } from './infer';
import { generateTsTypes } from './tstype';
import { deleteSchema, getSchema, listSchemas, mergeQuery, saveSchema, validateWs, type KVNamespaceLike } from './store';
import { d1Store, type D1Like } from './d1';
import { DslError, typeDocsFor, type DslErrorInfo } from './registry';
import { OG_PNG_B64 } from './og';

export interface Env {
  /** D1 바인딩 (권장) — KV 대비 쓰기 한도 100배. 있으면 KV 보다 우선 사용 */
  DB?: D1Like;
  /** KV 바인딩 (폴백) — DB 가 없을 때 사용. 없으면 팀 저장 기능만 비활성 */
  SCHEMAS?: KVNamespaceLike;
  /**
   * Workers Rate Limiting 바인딩 (wrangler.toml unsafe.bindings) —
   * workers.dev 에서도 동작하는 분산 리미터. 없으면 메모리 리미터로 폴백.
   */
  SAVE_RL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

/**
 * 응답 언어 선택 — Accept-Language 가 ko 로 시작하면 ko, 그 외 en.
 * 헤더가 없으면 ko (기존 테스트·기존 사용자 하위호환). 시드 계산과는 완전히 무관.
 */
const pickLang = (req: Request): 'ko' | 'en' =>
  (req.headers.get('accept-language') || 'ko').trim().toLowerCase().startsWith('ko') ? 'ko' : 'en';

/** ko/en 문자열 쌍에서 언어 선택 */
const pick = (lang: 'ko' | 'en', ko: string, en: string): string => (lang === 'en' ? en : ko);

/**
 * DslError info → 400 응답 본문. en 이고 hintEn 이 있으면 hint 자리에 hintEn 을 넣는다.
 * 응답 JSON 의 키는 지금처럼 hint 하나만 — hintEn 키는 항상 제거한다.
 */
function dslBody(info: DslErrorInfo, lang: 'ko' | 'en'): Omit<DslErrorInfo, 'hintEn'> {
  const { hintEn, ...rest } = info;
  return lang === 'en' && hintEn ? { ...rest, hint: hintEn } : rest;
}

// _status>=400 일 때 성공 데이터 대신 나가는 기본 실패 바디.
// 키가 {error, status, message} 라 DSL 에러({error, field, hint})와 한눈에 구분된다 —
// 앞은 "사용자가 주문한 목 실패", 뒤는 "mocappi 가 URL 을 못 읽음".
const FAIL_REASONS: Record<number, [string, string, string]> = {
  400: ['Bad Request', '요청이 올바르지 않습니다.', 'The request is malformed.'],
  401: ['Unauthorized', '인증이 필요합니다.', 'Authentication is required.'],
  403: ['Forbidden', '권한이 없습니다.', 'You do not have permission.'],
  404: ['Not Found', '요청한 리소스를 찾을 수 없습니다.', 'The requested resource was not found.'],
  409: ['Conflict', '이미 존재하는 리소스입니다.', 'The resource already exists.'],
  422: ['Unprocessable Entity', '입력값 검증에 실패했습니다.', 'Validation failed.'],
  429: ['Too Many Requests', '요청이 너무 많습니다.', 'Too many requests.'],
  500: ['Internal Server Error', '서버 오류가 발생했습니다.', 'An internal server error occurred.'],
  502: ['Bad Gateway', '게이트웨이 오류입니다.', 'Bad gateway.'],
  503: ['Service Unavailable', '서비스를 사용할 수 없습니다.', 'The service is unavailable.'],
};

function failBody(status: number, lang: 'ko' | 'en'): Record<string, unknown> {
  const r = FAIL_REASONS[status];
  return {
    error: r ? r[0] : 'Error',
    status,
    message: r ? pick(lang, r[1], r[2]) : pick(lang, '요청을 처리하지 못했습니다.', 'The request could not be processed.'),
  };
}

const noKv = (lang: 'ko' | 'en') => ({
  error: 'Storage not configured',
  hint: pick(
    lang,
    '저장소(D1 또는 KV)가 연결되지 않아 팀 저장을 쓸 수 없습니다. README 의 "팀 저장 활성화" 절차를 따라주세요.',
    'No storage (D1 or KV) is bound, so team save is unavailable. Follow the "Enable team save" steps in the README.',
  ),
});

// 저장 리미터 2계층:
//  1) SAVE_RL 바인딩 — 분산 버스트 방어 (Rate Limiting 바인딩은 창을 10/60초만 지원)
//  2) 아래 메모리 리미터 — 시간당 상한 (isolate 단위 베스트에포트)
// 목적: 버그 루프·스팸이 KV 쓰기 일일 한도(무료 1,000)를 태우는 것을 차단.
const SAVE_WINDOW_MS = 60 * 60 * 1000; // 1시간
const SAVE_MAX_PER_WINDOW = 10;
const saveHits = new Map<string, number[]>();

function saveLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (saveHits.get(ip) ?? []).filter((t) => now - t < SAVE_WINDOW_MS);
  if (arr.length >= SAVE_MAX_PER_WINDOW) {
    saveHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  if (saveHits.size > 10_000) saveHits.clear(); // 메모리 상한 — 드물게 초기화돼도 베스트에포트라 무방
  saveHits.set(ip, arr);
  return false;
}

/**
 * _format=ndjson|csv — 아이템을 배치 단위로 생성하며 스트리밍.
 * 데이터는 JSON 응답과 완전히 동일하다 (_format 은 baseSeed 에서 제외).
 */
function streamResponse(q: ParsedQuery): Response {
  const baseSeed = baseSeedOf(q);
  const start = (q.page - 1) * q.limit;
  // 검색 모드면 매치를 먼저 구해 페이지 슬라이스를 스트리밍 (창이 1,000이라 메모리 부담 없음)
  const searched = q.q !== null ? searchMatches(q).slice(start, start + q.limit) : null;
  const count = searched ? searched.length : Math.max(0, Math.min(q.limit, q.total - start));
  const enc = new TextEncoder();
  const BATCH = 100;
  let i = 0;
  let headerSent = false;
  const stream = new ReadableStream({
    pull(controller) {
      let chunk = '';
      if (q.format === 'csv' && !headerSent) {
        chunk += csvHeader(q) + '\r\n';
        headerSent = true;
      }
      const end = Math.min(i + BATCH, count);
      for (; i < end; i++) {
        const item = searched ? searched[i] : generateItem(baseSeed, start + i, q);
        chunk += q.format === 'csv' ? csvRow(item, q) + '\r\n' : JSON.stringify(item) + '\n';
      }
      if (chunk) controller.enqueue(enc.encode(chunk));
      if (i >= count) controller.close();
    },
  });
  return new Response(stream, {
    status: q.status,
    headers: {
      'content-type': q.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

// /api/ 뒤 1~8 단계 경로 — /api/v2/users/123/orders 처럼. 경로는 시드에 안 들어간다
// (데이터는 쿼리로만 결정 — 부모 id 별로 다른 데이터가 필요하면 _seed=123 을 쓰세요).
const RESOURCE_RE = /^\/api\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,7})\/?$/;

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    // 저장소 선택 — D1(쓰기 100,000/일) 우선, KV(1,000/일) 폴백
    const storage = env.DB ? d1Store(env.DB) : env.SCHEMAS;
    // 서버 발신 문자열(힌트·안내) 언어 — 생성 데이터의 _locale 과는 별개 개념
    const lang = pickLang(request);

    // CORS 프리플라이트 — 목 API 에서 CORS 가 막히면 존재 의미가 없다
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(guiHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    // SEO/공유 정적 리소스
    if (url.pathname === '/google8079946a1d05313a.html') {
      // Google Search Console 소유권 확인 파일 — 삭제하면 소유권이 풀리므로 유지
      return new Response('google-site-verification: google8079946a1d05313a.html', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      });
    }
    if (url.pathname === '/og.png') {
      const bin = Uint8Array.from(atob(OG_PNG_B64), (c) => c.charCodeAt(0));
      return new Response(bin, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' },
      });
    }

    if (url.pathname === '/schema/types') {
      return json(typeDocsFor(lang));
    }

    // 현재 스키마 → TypeScript 타입 코드 (text/plain)
    if (url.pathname === '/schema/ts') {
      try {
        const params = new URLSearchParams(url.search);
        const resource = params.get('_res') || 'item';
        params.delete('_res');
        const q = parseQuery(params);
        // ponytail: 쓰기 메서드는 단건 응답이라 _wrap=one 과 같은 타입.
        // DELETE(204 무본문)도 단건 타입이 나오지만, 타입을 안 쓰는 쪽이라 분기를 두지 않는다.
        const wrap = q.method && q.method !== 'GET' ? 'one' : q.wrap;
        return new Response(generateTsTypes(q.fields, resource, wrap, lang), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS_HEADERS },
        });
      } catch (e) {
        if (e instanceof DslError) return json(dslBody(e.info, lang), 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    // 팀 스키마 저장 (content-addressed — 같은 내용은 같은 ID)
    if (url.pathname === '/schema/save') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', hint: pick(lang, '{name, res, query} 를 POST 로 보내세요.', 'Send {name, res, query} as a POST request.') }, 405);
      }
      if (!storage) return json(noKv(lang), 501);
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      // 버스트(바인딩, 분산) 와 시간당 상한(메모리) 둘 다 통과해야 저장
      const burstLimited = env.SAVE_RL ? !(await env.SAVE_RL.limit({ key: ip })).success : false;
      if (burstLimited || saveLimited(ip)) {
        return json(
          {
            error: 'Too many saves',
            hint: pick(
              lang,
              `너무 많이 시도해서 잠시 차단되었습니다. 저장은 1시간에 ${SAVE_MAX_PER_WINDOW}회까지 — 잠시 후 다시 시도하세요.`,
              `Temporarily blocked after too many attempts. Saves are limited to ${SAVE_MAX_PER_WINDOW} per hour — try again later.`,
            ),
          },
          429,
        );
      }
      let body: { name?: unknown; res?: unknown; query?: unknown; ws?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON', hint: pick(lang, '{name, res, query} 형식의 JSON 이어야 합니다.', 'The body must be JSON of the form {name, res, query}.') }, 400);
      }
      try {
        const ws = validateWs(body.ws);
        if (!ws) {
          return json(
            {
              error: 'Workspace required',
              hint: pick(
                lang,
                '저장은 워크스페이스에서만 가능합니다. GUI 의 저장소 버튼에서 워크스페이스를 만들어 주세요. 공용 풀은 조회 전용입니다.',
                'Saving requires a workspace. Create one via the workspace button in the GUI. The public pool is read-only.',
              ),
            },
            400,
          );
        }
        const rec = await saveSchema(storage, ws, body.name, body.res, body.query);
        return json({ ...rec, apiUrl: `/api/${rec.res}?_s=${rec.sid}` });
      } catch (e) {
        if (e instanceof DslError) return json(dslBody(e.info, lang), 400);
        // KV 일일 쓰기 한도(무료 1,000/일) 소진 — put 거부를 친절한 안내로 변환
        if (/429|too many|quota|limit exceeded/i.test(String(e))) {
          return json(
            {
              error: 'Daily save quota exceeded',
              hint: pick(
                lang,
                '오늘의 저장 한도가 모두 사용되었습니다. 내일 다시 시도해주세요 (한국 시간 오전 9시 초기화). 저장된 프리셋 불러오기와 데이터 생성 API 는 계속 정상 동작합니다.',
                "Today's save quota has been used up. Please try again tomorrow (resets at 09:00 KST). Loading saved presets and the data generation API keep working.",
              ),
            },
            503,
          );
        }
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    // 사용자 피드백 — KV 에 fb: 프리픽스로 저장 (90일 TTL). 조회는 wrangler CLI (README).
    if (url.pathname === '/feedback') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', hint: pick(lang, '{msg} 를 POST 로 보내세요.', 'Send {msg} as a POST request.') }, 405);
      }
      if (!storage) return json({ error: 'Storage not configured', hint: pick(lang, 'KV 미설정 — 피드백을 저장할 수 없습니다.', 'KV is not configured — feedback cannot be stored.') }, 501);
      const fbIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const fbLimited = env.SAVE_RL ? !(await env.SAVE_RL.limit({ key: 'fb:' + fbIp })).success : saveLimited('fb:' + fbIp);
      if (fbLimited) {
        return json({ error: 'Too many requests', hint: pick(lang, '피드백이 너무 잦습니다. 잠시 후 다시 보내주세요.', 'Too many feedback submissions. Please try again shortly.') }, 429);
      }
      let fb: { msg?: unknown };
      try {
        fb = (await request.json()) as typeof fb;
      } catch {
        return json({ error: 'Invalid JSON', hint: pick(lang, '{msg} 형식의 JSON 이어야 합니다.', 'The body must be JSON of the form {msg}.') }, 400);
      }
      const msg = typeof fb.msg === 'string' ? fb.msg.trim() : '';
      if (msg.length < 5 || msg.length > 1000) {
        return json({ error: 'Invalid message', hint: pick(lang, '피드백은 5~1000자 사이로 적어주세요.', 'Feedback must be between 5 and 1000 characters.') }, 400);
      }
      const at = new Date().toISOString();
      const key = `fb:${at}:${Math.random().toString(36).slice(2, 6)}`;
      await storage.put(key, JSON.stringify({ msg, at, ip: fbIp }), {
        metadata: { at },
        expirationTtl: 60 * 60 * 24 * 90,
      });
      return json({ ok: true, hint: pick(lang, '전달됐어요 — 고맙습니다!', 'Delivered — thank you!') });
    }

    // 저장 목록 / 개별 조회 / 삭제 (?ws=<워크스페이스> — 없으면 공용 풀)
    if (url.pathname === '/schema/saved') {
      if (!storage) return json(noKv(lang), 501);
      try {
        const ws = validateWs(url.searchParams.get('ws'));
        return json({ ws, items: await listSchemas(storage, ws) });
      } catch (e) {
        if (e instanceof DslError) return json(dslBody(e.info, lang), 400);
        throw e;
      }
    }
    const sm = url.pathname.match(/^\/schema\/saved\/([a-z0-9.]{4,42})$/);
    if (sm) {
      if (!storage) return json(noKv(lang), 501);
      const listHint = pick(lang, 'GET /schema/saved 로 목록을 확인하세요.', 'Check the list via GET /schema/saved.');
      if (request.method === 'DELETE') {
        const ok = await deleteSchema(storage, sm[1]);
        return ok
          ? json({ ok: true, hint: pick(lang, '삭제됨 — 이 ID 를 쓰는 _s= URL 은 더 이상 동작하지 않습니다.', 'Deleted — _s= URLs using this ID will no longer work.') })
          : json({ error: 'Unknown schema id', value: sm[1], hint: listHint }, 404);
      }
      const rec = await getSchema(storage, sm[1]);
      if (!rec) return json({ error: 'Unknown schema id', value: sm[1], hint: listHint }, 404);
      return json(rec);
    }

    // JSON 예시 붙여넣기 → 스키마 추론
    if (url.pathname === '/schema/infer') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', hint: pick(lang, 'JSON 예시를 POST body 로 보내세요.', 'Send a JSON example as the POST body.') }, 405);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON', hint: pick(lang, 'JSON 파싱에 실패했습니다. 올바른 JSON 인지 확인하세요.', 'Failed to parse JSON. Make sure the body is valid JSON.') }, 400);
      }
      try {
        return json(inferSchema(body));
      } catch (e) {
        if (e instanceof DslError) return json(dslBody(e.info, lang), 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    const m = url.pathname.match(RESOURCE_RE);
    if (m) {
      if (!ALLOWED_METHODS.has(request.method)) {
        return json({ error: 'Method not allowed', hint: pick(lang, `허용 메서드: ${[...ALLOWED_METHODS].join(', ')}`, `Allowed methods: ${[...ALLOWED_METHODS].join(', ')}`) }, 405);
      }
      try {
        // _s=<id> 면 저장된 스키마를 불러와 요청 파라미터와 병합 (요청이 우선)
        let params = url.searchParams;
        const sid = params.get('_s');
        if (sid !== null) {
          if (!storage) return json(noKv(lang), 501);
          const rec = await getSchema(storage, sid);
          if (!rec) {
            return json({ error: 'Unknown schema id', field: '_s', value: sid, hint: pick(lang, '저장된 스키마가 없습니다. GET /schema/saved 로 목록을 확인하세요.', 'No saved schema with this ID. Check the list via GET /schema/saved.') }, 404);
          }
          params = mergeQuery(rec.query, params);
        }
        const q = parseQuery(params);
        // 응답 모양을 정하는 메서드 — _method 가 있으면 그게 진실, 없으면 실제 verb.
        // (_method 덕분에 브라우저 주소창의 평범한 GET 으로도 POST 응답을 확인할 수 있다)
        const method = q.method ?? (request.method === 'HEAD' ? 'GET' : request.method);
        const sleep = () => (q.delay > 0 ? new Promise((r) => setTimeout(r, q.delay)) : Promise.resolve());

        // 실패 응답이 최우선 — 메서드·_format 과 무관하게 에러 바디를 낸다 (실제 API 도 그렇다)
        if (q.status >= 400) {
          await sleep();
          return json(q.body ?? failBody(q.status, lang), q.status);
        }
        if (method === 'DELETE') {
          await sleep();
          return new Response(null, { status: q.statusSet ? q.status : 204, headers: { 'cache-control': 'no-store', ...CORS_HEADERS } });
        }
        if (q.format !== 'json') {
          await sleep();
          return streamResponse(q);
        }
        // 생성 먼저 — _delay/_status/_method 가 달라도 데이터는 동일.
        // 쓰기 메서드는 방금 만들어진/고쳐진 한 건을 돌려준다 = 목록의 0번 아이템
        const body = method === 'GET' ? generateResponse(q) : generateItem(baseSeedOf(q), 0, q);
        await sleep();
        return json(body, q.statusSet ? q.status : method === 'POST' ? 201 : 200);
      } catch (e) {
        if (e instanceof DslError) return json(dslBody(e.info, lang), 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    return json(
      {
        error: 'Not found',
        hint: pick(
          lang,
          'GET /api/<리소스명>?필드=타입 형태로 호출하세요. GUI: GET / , 타입 목록: GET /schema/types',
          'Call GET /api/<resource>?field=type. GUI: GET / , type list: GET /schema/types',
        ),
      },
      404,
    );
  },
};

