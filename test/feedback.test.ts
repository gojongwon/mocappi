/**
 * POST /feedback — KV 저장 + 리미터 + 검증
 */
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { KVNamespaceLike } from '../src/store';

class MemKV implements KVNamespaceLike {
  store = new Map<string, { value: string; metadata?: unknown }>();
  async get(k: string) { return this.store.get(k)?.value ?? null; }
  async put(k: string, v: string, o?: { metadata?: unknown }) { this.store.set(k, { value: v, metadata: o?.metadata }); }
  async delete(k: string) { this.store.delete(k); }
  async list(o?: { prefix?: string }) {
    const p = o?.prefix ?? '';
    return { keys: [...this.store.entries()].filter(([k]) => k.startsWith(p)).map(([name, v]) => ({ name, metadata: v.metadata })) };
  }
}

const post = (msg: unknown, kv: MemKV, ip = '10.20.0.1') =>
  worker.fetch(
    new Request('https://x/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ msg }),
    }),
    { SCHEMAS: kv },
  );

describe('POST /feedback', () => {
  it('fb: 프리픽스로 저장되고 ok 응답', async () => {
    const kv = new MemKV();
    const res = await post('CSV 에 BOM 넣어주세요', kv);
    expect(res.status).toBe(200);
    const keys = [...kv.store.keys()].filter((k) => k.startsWith('fb:'));
    expect(keys).toHaveLength(1);
    const rec = JSON.parse(kv.store.get(keys[0])!.value) as { msg: string; at: string };
    expect(rec.msg).toContain('BOM');
    expect(rec.at).toBeTruthy();
  });

  it('너무 짧거나 긴 메시지는 400', async () => {
    const kv = new MemKV();
    expect((await post('짧다', kv)).status).toBe(400);
    expect((await post('x'.repeat(1001), kv)).status).toBe(400);
    expect((await post(123, kv)).status).toBe(400);
  });

  it('IP 리미터 — 저장 리미터와 별도 키로 동작', async () => {
    const kv = new MemKV();
    for (let i = 0; i < 10; i++) {
      expect((await post(`의견 ${i} 입니다아`, kv, '10.20.9.9')).status).toBe(200);
    }
    expect((await post('11번째 의견입니다', kv, '10.20.9.9')).status).toBe(429);
  });

  it('GET 은 405, KV 미설정은 501', async () => {
    expect((await worker.fetch(new Request('https://x/feedback'))).status).toBe(405);
    const res = await worker.fetch(new Request('https://x/feedback', { method: 'POST', body: '{"msg":"열자 이상 의견"}' }));
    expect(res.status).toBe(501);
  });
});
