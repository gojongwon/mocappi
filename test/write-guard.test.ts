/**
 * KV 쓰기 보호 — 중복 쓰기 스킵 + 저장 베스트에포트 리미터
 */
import { describe, it, expect } from 'vitest';
import { saveSchema, type KVNamespaceLike, type SavedSchema } from '../src/store';
import worker from '../src/index';

class CountingKV implements KVNamespaceLike {
  store = new Map<string, { value: string; metadata?: unknown }>();
  puts = 0;
  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.puts++;
    this.store.set(key, { value, metadata: options?.metadata });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';
    return {
      keys: [...this.store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata })),
    };
  }
}

const WS = 'guardws00001';
const Q = 'name=person.fullName&age=int:20~60';

describe('중복 쓰기 스킵', () => {
  it('같은 내용·같은 이름 재저장은 KV 쓰기 없이 기존 레코드 반환', async () => {
    const kv = new CountingKV();
    const a = await saveSchema(kv, WS, '사용자', 'users', Q);
    const b = await saveSchema(kv, WS, '사용자', 'users', Q);
    expect(kv.puts).toBe(1);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.sid).toBe(a.sid);
  });

  it('이름이 바뀌면 다시 쓴다 (이름 변경 허용)', async () => {
    const kv = new CountingKV();
    await saveSchema(kv, WS, '사용자', 'users', Q);
    const b = await saveSchema(kv, WS, '유저 목록', 'users', Q);
    expect(kv.puts).toBe(2);
    expect(b.name).toBe('유저 목록');
  });

  it('7일이 지나면 TTL 갱신을 위해 다시 쓴다', async () => {
    const kv = new CountingKV();
    const a = await saveSchema(kv, WS, '사용자', 'users', Q);
    // 저장된 레코드의 createdAt 을 8일 전으로 조작
    const key = [...kv.store.keys()][0];
    const rec = JSON.parse(kv.store.get(key)!.value) as SavedSchema;
    rec.createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    kv.store.set(key, { value: JSON.stringify(rec) });
    const b = await saveSchema(kv, WS, '사용자', 'users', Q);
    expect(kv.puts).toBe(2);
    expect(Date.parse(b.createdAt)).toBeGreaterThan(Date.parse(a.createdAt) - 1000);
  });
});

describe('저장 리미터 (베스트에포트)', () => {
  const save = (kv: KVNamespaceLike, ip: string, i: number) =>
    worker.fetch(
      new Request('https://x/schema/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ name: `s${i}`, res: 'users', query: `a=int:1~${i + 2}`, ws: WS }),
      }),
      { SCHEMAS: kv },
    );

  it('분당 10회 초과 시 429, 다른 IP 는 영향 없음', async () => {
    const kv = new CountingKV();
    for (let i = 0; i < 10; i++) {
      expect((await save(kv, '10.0.0.1', i)).status).toBe(200);
    }
    const blocked = await save(kv, '10.0.0.1', 10);
    expect(blocked.status).toBe(429);
    const other = await save(kv, '10.0.0.2', 99);
    expect(other.status).toBe(200);
  });

  it('SAVE_RL 바인딩이 있으면 그것을 우선 사용', async () => {
    const kv = new CountingKV();
    const calls: string[] = [];
    const rl = (ok: boolean) => ({ limit: async ({ key }: { key: string }) => (calls.push(key), { success: ok }) });
    const req = (ip: string) =>
      new Request('https://x/schema/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ name: 'rl', res: 'users', query: 'a=int:1~5', ws: WS }),
      });
    // 바인딩이 거부하면 첫 호출도 429
    const denied = await worker.fetch(req('10.1.0.1'), { SCHEMAS: kv, SAVE_RL: rl(false) });
    expect(denied.status).toBe(429);
    // 바인딩이 허용하면 200, key 로 IP 가 전달됨
    const allowed = await worker.fetch(req('10.1.0.2'), { SCHEMAS: kv, SAVE_RL: rl(true) });
    expect(allowed.status).toBe(200);
    expect(calls).toContain('10.1.0.2');
  });

  it('데이터 생성 API 는 리미터와 무관', async () => {
    for (let i = 0; i < 15; i++) {
      const res = await worker.fetch(
        new Request('https://x/api/u?a=int:1~5', { headers: { 'cf-connecting-ip': '10.0.0.1' } }),
      );
      expect(res.status).toBe(200);
    }
  });
});
