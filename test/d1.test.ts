/**
 * D1 어댑터 — 우리가 쓰는 5개 SQL 문을 인메모리로 재현한 FakeD1 로 어댑터 의미론 검증.
 * (실제 SQLite 검증은 wrangler dev 의 로컬 D1 로 별도 수행)
 */
import { describe, it, expect } from 'vitest';
import { d1Store, type D1Like } from '../src/d1';
import { saveSchema, listSchemas, getSchema, deleteSchema } from '../src/store';

class FakeD1 implements D1Like {
  rows = new Map<string, { value: string; metadata: string | null; expires_at: number | null }>();
  prepare(sql: string) {
    const rows = this.rows;
    return {
      bind: (...a: unknown[]) => ({
        async first<T>() {
          if (!sql.startsWith('SELECT value')) throw new Error('unexpected first(): ' + sql);
          const [key, now] = a as [string, number];
          const r = rows.get(key);
          if (!r || (r.expires_at !== null && r.expires_at <= now)) return null;
          return { value: r.value } as T;
        },
        async run() {
          if (sql.startsWith('CREATE TABLE')) return;
          if (sql.startsWith('INSERT INTO kv')) {
            const [key, value, metadata, expires_at] = a as [string, string, string | null, number | null];
            rows.set(key, { value, metadata, expires_at });
            return;
          }
          if (sql.startsWith('DELETE FROM kv')) { rows.delete(a[0] as string); return; }
          throw new Error('unexpected run(): ' + sql);
        },
        async all<T>() {
          if (!sql.startsWith('SELECT key, metadata')) throw new Error('unexpected all(): ' + sql);
          const [pattern, now, limit] = a as [string, number, number];
          const prefix = pattern.replace(/%$/, '').replace(/\\([\\%_])/g, '$1');
          const results = [...rows.entries()]
            .filter(([k, r]) => k.startsWith(prefix) && (r.expires_at === null || r.expires_at > now))
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .slice(0, limit)
            .map(([key, r]) => ({ key, metadata: r.metadata }));
          return { results: results as T[] };
        },
      }),
    };
  }
}

const WS = 'd1testws0001';

describe('d1Store 어댑터', () => {
  it('put/get/list/delete 왕복 + 메타데이터 보존', async () => {
    const kv = d1Store(new FakeD1());
    await kv.put('w:a:1', 'v1', { metadata: { name: '하나' } });
    await kv.put('w:a:2', 'v2', { metadata: { name: '둘' } });
    await kv.put('w:b:9', 'v9');
    expect(await kv.get('w:a:1')).toBe('v1');
    const { keys } = await kv.list({ prefix: 'w:a:' });
    expect(keys.map((k) => k.name)).toStrictEqual(['w:a:1', 'w:a:2']);
    expect((keys[0].metadata as { name: string }).name).toBe('하나');
    await kv.delete('w:a:1');
    expect(await kv.get('w:a:1')).toBeNull();
  });

  it('TTL 만료 — 지난 항목은 get/list 에서 제외', async () => {
    const fake = new FakeD1();
    const kv = d1Store(fake);
    await kv.put('w:t:1', 'x', { expirationTtl: 60 });
    expect(await kv.get('w:t:1')).toBe('x');
    fake.rows.get('w:t:1')!.expires_at = Math.floor(Date.now() / 1000) - 10; // 강제 만료
    expect(await kv.get('w:t:1')).toBeNull();
    expect((await kv.list({ prefix: 'w:t:' })).keys).toHaveLength(0);
  });

  it('store.ts 전체 플로우가 어댑터 위에서 동작 (save/list/get/delete)', async () => {
    const kv = d1Store(new FakeD1());
    const rec = await saveSchema(kv, WS, '유저', 'users', 'name=person.fullName');
    const again = await saveSchema(kv, WS, '유저', 'users', 'name=person.fullName');
    expect(again.createdAt).toBe(rec.createdAt); // 중복 쓰기 스킵도 동작
    const items = await listSchemas(kv, WS);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('유저');
    expect((await getSchema(kv, rec.sid))?.query).toBe(rec.query);
    expect(await deleteSchema(kv, rec.sid)).toBe(true);
    expect(await getSchema(kv, rec.sid)).toBeNull();
  });

  it('같은 DB 인스턴스는 어댑터를 캐시', () => {
    const fake = new FakeD1();
    expect(d1Store(fake)).toBe(d1Store(fake));
  });
});
