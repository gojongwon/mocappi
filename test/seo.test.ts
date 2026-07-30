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

  it('GUI head 에 description·OG·canonical·JSON-LD', async () => {
    const html = await (await worker.fetch(new Request('https://x/'))).text();
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('twitter:card');
  });
});
