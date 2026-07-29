/**
 * 라우터: GET / (GUI), GET /api/:resource, /schema/* (types·infer·ts·save·saved)
 * 의존성 없이 URL.pathname 분기.
 */
import guiHtml from './gui.html';
import { parseQuery, type ParsedQuery } from './dsl';
import { baseSeedOf, csvHeader, csvRow, generateItem, generateResponse } from './generate';
import { inferSchema } from './infer';
import { generateTsTypes } from './tstype';
import { deleteSchema, getSchema, listSchemas, mergeQuery, saveSchema, validateWs, type KVNamespaceLike } from './store';
import { DslError, TYPE_DOCS } from './registry';

export interface Env {
  /** wrangler.toml 의 kv_namespaces 바인딩 — 없으면 팀 저장 기능만 비활성 */
  SCHEMAS?: KVNamespaceLike;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const NO_KV = {
  error: 'Storage not configured',
  hint: 'KV 네임스페이스가 연결되지 않아 팀 저장을 쓸 수 없습니다. README 의 "팀 저장 활성화" 절차를 따라주세요.',
};

/**
 * _format=ndjson|csv — 아이템을 배치 단위로 생성하며 스트리밍.
 * 데이터는 JSON 응답과 완전히 동일하다 (_format 은 baseSeed 에서 제외).
 */
function streamResponse(q: ParsedQuery): Response {
  const baseSeed = baseSeedOf(q);
  const start = (q.page - 1) * q.limit;
  const count = Math.max(0, Math.min(q.limit, q.total - start));
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
        const item = generateItem(baseSeed, start + i, q);
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

const RESOURCE_RE = /^\/api\/([A-Za-z0-9_-]+)\/?$/;

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
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

    // 현재 스키마 → TypeScript 타입 코드 (text/plain)
    if (url.pathname === '/schema/ts') {
      try {
        const params = new URLSearchParams(url.search);
        const resource = params.get('_res') || 'item';
        params.delete('_res');
        const q = parseQuery(params);
        return new Response(generateTsTypes(q.fields, resource, q.wrap), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS_HEADERS },
        });
      } catch (e) {
        if (e instanceof DslError) return json(e.info, 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    // 팀 스키마 저장 (content-addressed — 같은 내용은 같은 ID)
    if (url.pathname === '/schema/save') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', hint: '{name, res, query} 를 POST 로 보내세요.' }, 405);
      }
      if (!env.SCHEMAS) return json(NO_KV, 501);
      let body: { name?: unknown; res?: unknown; query?: unknown; ws?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON', hint: '{name, res, query} 형식의 JSON 이어야 합니다.' }, 400);
      }
      try {
        const ws = validateWs(body.ws);
        if (!ws) {
          return json(
            { error: 'Workspace required', hint: '저장은 워크스페이스에서만 가능합니다. GUI 의 저장소 버튼에서 워크스페이스를 만들어 주세요. 공용 풀은 조회 전용입니다.' },
            400,
          );
        }
        const rec = await saveSchema(env.SCHEMAS, ws, body.name, body.res, body.query);
        return json({ ...rec, apiUrl: `/api/${rec.res}?_s=${rec.sid}` });
      } catch (e) {
        if (e instanceof DslError) return json(e.info, 400);
        return json({ error: 'Internal error', hint: String(e) }, 500);
      }
    }

    // 저장 목록 / 개별 조회 / 삭제 (?ws=<워크스페이스> — 없으면 공용 풀)
    if (url.pathname === '/schema/saved') {
      if (!env.SCHEMAS) return json(NO_KV, 501);
      try {
        const ws = validateWs(url.searchParams.get('ws'));
        return json({ ws, items: await listSchemas(env.SCHEMAS, ws) });
      } catch (e) {
        if (e instanceof DslError) return json(e.info, 400);
        throw e;
      }
    }
    const sm = url.pathname.match(/^\/schema\/saved\/([a-z0-9.]{4,42})$/);
    if (sm) {
      if (!env.SCHEMAS) return json(NO_KV, 501);
      if (request.method === 'DELETE') {
        const ok = await deleteSchema(env.SCHEMAS, sm[1]);
        return ok
          ? json({ ok: true, hint: '삭제됨 — 이 ID 를 쓰는 _s= URL 은 더 이상 동작하지 않습니다.' })
          : json({ error: 'Unknown schema id', value: sm[1], hint: 'GET /schema/saved 로 목록을 확인하세요.' }, 404);
      }
      const rec = await getSchema(env.SCHEMAS, sm[1]);
      if (!rec) return json({ error: 'Unknown schema id', value: sm[1], hint: 'GET /schema/saved 로 목록을 확인하세요.' }, 404);
      return json(rec);
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
        // _s=<id> 면 저장된 스키마를 불러와 요청 파라미터와 병합 (요청이 우선)
        let params = url.searchParams;
        const sid = params.get('_s');
        if (sid !== null) {
          if (!env.SCHEMAS) return json(NO_KV, 501);
          const rec = await getSchema(env.SCHEMAS, sid);
          if (!rec) {
            return json({ error: 'Unknown schema id', field: '_s', value: sid, hint: '저장된 스키마가 없습니다. GET /schema/saved 로 목록을 확인하세요.' }, 404);
          }
          params = mergeQuery(rec.query, params);
        }
        const q = parseQuery(params);
        if (q.format !== 'json') {
          if (q.delay > 0) await new Promise((r) => setTimeout(r, q.delay));
          return streamResponse(q);
        }
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

