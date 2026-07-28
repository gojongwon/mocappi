/**
 * 라우터: GET / (GUI), GET /api/:resource, GET /schema/types, POST /schema/infer
 * 의존성 없이 URL.pathname 분기.
 */
import guiHtml from './gui.html';
import { parseQuery } from './dsl';
import { generateResponse } from './generate';
import { inferSchema } from './infer';
import { DslError, TYPE_DOCS } from './registry';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

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

const RESOURCE_RE = /^\/api\/([A-Za-z0-9_-]+)\/?$/;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS 프리플라이트 — 목 API 에서 CORS 가 막히면 존재 의미가 없다
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(guiHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    if (url.pathname === '/schema/types') {
      return json(TYPE_DOCS);
    }

    // JSON 예시 붙여넣기 → 스키마 추론
    if (url.pathname === '/schema/infer') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', hint: 'JSON 예시를 POST body 로 보내세요.' }, 405);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON', hint: 'JSON 파싱에 실패했습니다. 올바른 JSON 인지 확인하세요.' }, 400);
      }
      try {
        return json(inferSchema(body));
      } catch (e) {
        if (e instanceof DslError) return json(e.info, 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    const m = url.pathname.match(RESOURCE_RE);
    if (m) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed', hint: 'v1 은 GET 만 지원합니다. 쓰기 API 는 v2 후보.' }, 405);
      }
      try {
        const q = parseQuery(url.searchParams);
        const body = generateResponse(q); // 생성 먼저 — _delay/_status 가 달라도 데이터는 동일
        if (q.delay > 0) await new Promise((r) => setTimeout(r, q.delay));
        return json(body, q.status);
      } catch (e) {
        if (e instanceof DslError) return json(e.info, 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    return json(
      { error: 'Not found', hint: 'GET /api/<리소스명>?필드=타입 형태로 호출하세요. GUI: GET / , 타입 목록: GET /schema/types' },
      404,
    );
  },
};
