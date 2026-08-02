/**
 * SEO 리소스 — robots.txt / og.png / 메타 태그
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('SEO', () => {
  it('robots.txt 는 전체 허용', async () => {
    const res = await worker.fetch(new Request('https://x/robots.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('User-agent: *');
  });

  it('og.png 는 유효한 PNG', async () => {
    const res = await worker.fetch(new Request('https://x/og.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(10000);
    expect([...buf.slice(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]); // PNG 시그니처
  });

  it('favicon.svg 는 크롤 가능한 SVG', async () => {
    const res = await worker.fetch(new Request('https://x/favicon.svg'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('<svg');
  });

  it('GUI head 에 description·OG·canonical·JSON-LD', async () => {
    const html = await (await worker.fetch(new Request('https://x/'))).text();
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('twitter:card');
    // data: URI 로 되돌리면 Googlebot-Image 가 아이콘을 못 가져간다
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
  });
});

describe('Search Console 소유권 확인', () => {
  it('인증 파일이 정확한 내용으로 서빙된다', async () => {
    const res = await worker.fetch(new Request('https://x/google8079946a1d05313a.html'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('google-site-verification: google8079946a1d05313a.html');
  });
});
