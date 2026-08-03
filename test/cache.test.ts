/**
 * 엣지 캐시(wrangler.toml 의 [cache]) 대상 판정.
 *
 * 캐시 키에 Accept-Language 가 없다는 게 이 테스트의 존재 이유다 —
 * 언어로 본문이 갈리는 응답이 캐시를 타면 ko 응답이 en 사용자에게 나간다.
 * json() 기본값이 no-store 라 새 라우트는 저절로 안전하지만, 기본값이 뒤집히면
 * 조용히 통과하므로 여기서 세 라우트를 못박아 둔다.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const cc = async (path: string) =>
  (await worker.fetch(new Request(BASE + path))).headers.get('cache-control');

describe('캐시 대상', () => {
  it('결정적 /api 성공 응답 → max-age=300', async () => {
    expect(await cc('/api/users?id=uuid&name=person.fullName')).toBe('public, max-age=300');
  });

  it('_format=csv·ndjson 도 같은 데이터라 같이 캐시', async () => {
    expect(await cc('/api/users?id=uuid&_format=csv')).toBe('public, max-age=300');
    expect(await cc('/api/users?id=uuid&_format=ndjson')).toBe('public, max-age=300');
  });

  it('_status=302 — 4xx 미만이고 본문이 데이터라 캐시 대상', async () => {
    expect(await cc('/api/users?id=uuid&_status=302')).toBe('public, max-age=300');
  });

  it('_method=post 단건 응답도 결정적이라 캐시 대상', async () => {
    expect(await cc('/api/users?id=uuid&_method=post')).toBe('public, max-age=300');
  });
});

describe('캐시 제외', () => {
  it('_delay>0 — HIT 가 워커를 건너뛰면 지연이 사라진다', async () => {
    expect(await cc('/api/users?id=uuid&_delay=100')).toBe('no-store');
  });

  it('_status>=400 — 실패 바디가 Accept-Language 로 갈린다', async () => {
    expect(await cc('/api/users?id=uuid&_status=404')).toBe('no-store');
    expect(await cc('/api/users?id=uuid&_status=500')).toBe('no-store');
  });

  it('DSL 에러(400) — 힌트가 Accept-Language 로 갈린다', async () => {
    expect(await cc('/api/users?age=int:20-60')).toBe('no-store');
  });

  it('언어 의존·가변 라우트는 캐시 금지', async () => {
    for (const p of ['/schema/types', '/schema/ts?id=uuid', '/schema/saved', '/nope']) {
      expect(await cc(p), p).toBe('no-store');
    }
  });
});

describe('GUI HTML', () => {
  // 엣지만 재사용하고 브라우저는 매번 새로 받는다 — 배포 직후 새 소식이 바로 보이도록
  it('s-maxage 로 엣지만 캐시, max-age=0 으로 브라우저는 항상 갱신', async () => {
    expect(await cc('/')).toBe('public, max-age=0, s-maxage=3600');
  });
});

describe('캐시가 데이터를 바꾸지 않는다', () => {
  // cacheHeader 는 헤더만 건드려야 한다 — 본문이 달라지면 결정성 약속이 깨진다
  it('_delay 유무로 본문이 달라지지 않는다', async () => {
    const plain = await (await worker.fetch(new Request(BASE + '/api/users?id=uuid&_total=5'))).text();
    const delayed = await (await worker.fetch(new Request(BASE + '/api/users?id=uuid&_total=5&_delay=50'))).text();
    expect(delayed).toBe(plain);
  });
});
