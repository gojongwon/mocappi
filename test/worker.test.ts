/**
 * Worker fetch 핸들러 통합 테스트 — 표준 Request/Response 만 쓰므로 Node 에서 직접 실행.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const get = (path: string) => worker.fetch(new Request(BASE + path));

describe('라우팅', () => {
  it('GET / → GUI HTML', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('mocappi');
  });

  it('GET /schema/types → 타입 목록 JSON', async () => {
    const res = await get('/schema/types');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dslTypes: unknown[]; fakerPaths: unknown[]; reserved: unknown[] };
    expect(body.dslTypes.length).toBeGreaterThan(5);
    expect(body.fakerPaths.length).toBeGreaterThan(10);
    expect(body.reserved.length).toBe(14);
  });

  it('알 수 없는 경로 → 404 + 힌트', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('/api/');
  });

  // POST/PUT/PATCH/DELETE 는 write.test.ts 에서 다룬다 — 그 외 메서드는 405
  it('지원하지 않는 메서드 → 405', async () => {
    const res = await worker.fetch(new Request(BASE + '/api/users?id=uuid', { method: 'LOCK' }));
    expect(res.status).toBe(405);
  });
});

describe('CORS', () => {
  it('OPTIONS 프리플라이트 → 204 + 허용 헤더', async () => {
    const res = await worker.fetch(new Request(BASE + '/api/users', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('모든 JSON 응답에 ACAO 헤더', async () => {
    for (const p of ['/api/users?id=uuid', '/schema/types', '/nope', '/api/users?bad=nope']) {
      const res = await get(p);
      expect(res.headers.get('Access-Control-Allow-Origin'), p).toBe('*');
    }
  });
});

describe('/api/:resource', () => {
  it('정상 응답 envelope', async () => {
    const res = await get('/api/users?name=person.fullName&age=int:20~60&_total=25&_limit=10&_page=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number; hasNext: boolean };
    expect(body.data).toHaveLength(5);
    expect(body.total).toBe(25);
    expect(body.hasNext).toBe(false);
  });

  it('같은 URL 2회 → 응답 텍스트 바이트 동일', async () => {
    const url = '/api/users?id=uuid&name=person.fullName&tags[]=lorem.word:3&_total=50&_limit=7&_page=2';
    const [a, b] = [await (await get(url)).text(), await (await get(url)).text()];
    expect(a).toBe(b);
  });

  it('_wrap=none → 배열만', async () => {
    const res = await get('/api/users?id=uuid&_wrap=none&_limit=3');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('_status 강제 — 상태코드만 바뀌고 본문 데이터는 동일', async () => {
    const a = await get('/api/users?id=uuid&_total=5');
    const b = await get('/api/users?id=uuid&_total=5&_status=500');
    expect(a.status).toBe(200);
    expect(b.status).toBe(500);
    expect(await b.text()).toBe(await a.text());
  });

  it('_delay 동작 (100ms 이상 걸림)', async () => {
    const t0 = Date.now();
    await get('/api/users?id=uuid&_delay=120');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('DSL 에러 → 400 + 필드/힌트', async () => {
    const res = await get('/api/users?age=int:20-60');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; hint: string };
    expect(body.field).toBe('age');
    expect(body.hint).toContain('~');
  });

  it('_locale=ko 기본 → 한글 데이터', async () => {
    const res = await get('/api/users?name=person.fullName&_limit=20');
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((d) => d.name).join('')).toMatch(/[가-힣]/);
  });
});
