/**
 * KV 쓰기 보호 — 중복 쓰기 스킵 + 저장 베스트에포트 리미터
 */
import { describe, it, expect } from 'vitest';
import { saveSchema, type KVNamespaceLike, type SavedSchema } from '../src/store';
import worker from '../src/index';
import { CountingKV } from './helpers';

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

describe('KV 일일 쓰기 한도 소진', () => {
  it('put 이 429 로 거부되면 503 + 친절한 안내', async () => {
    const kv = new CountingKV();
    kv.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    const res = await worker.fetch(
      new Request('https://x/schema/save', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '10.3.0.1' },
        body: JSON.stringify({ name: 'q', res: 'users', query: 'a=int:1~5', ws: WS }),
      }),
      { SCHEMAS: kv },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('저장 한도');
    expect(body.hint).toContain('초기화');
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

  it('시간당 10회 초과 시 429 + 차단 안내, 다른 IP 는 영향 없음', async () => {
    const kv = new CountingKV();
    for (let i = 0; i < 10; i++) {
      expect((await save(kv, '10.0.0.1', i)).status).toBe(200);
    }
    const blocked = await save(kv, '10.0.0.1', 10);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { hint: string }).hint).toContain('차단');
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

  // 삭제도 쓰기다 — GUI 드롭다운에 ✕ 가 생겨 누구나 닿는다. 저장과 별개 카운터라 서로 굶기지 않는다
  it('삭제도 시간당 10회 제한, 저장 카운터와 분리', async () => {
    const kv = new CountingKV();
    const rec = await saveSchema(kv, WS, '지울것', 'users', Q);
    const del = (ip: string) =>
      worker.fetch(new Request('https://x/schema/saved/' + rec.sid, { method: 'DELETE', headers: { 'cf-connecting-ip': ip } }), { SCHEMAS: kv });

    // 첫 삭제만 200, 이후는 대상이 없어 404 — 리미터는 그와 무관하게 세다가 11번째를 막는다
    expect((await del('10.4.0.1')).status).toBe(200);
    for (let i = 1; i < 10; i++) expect((await del('10.4.0.1')).status).toBe(404);
    expect((await del('10.4.0.1')).status).toBe(429);

    // 같은 IP 의 저장 카운터는 삭제 10회에 닳지 않았다
    expect((await save(kv, '10.4.0.1', 1)).status).toBe(200);
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
