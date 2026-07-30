/**
 * D1(SQLite) → KVNamespaceLike 어댑터.
 *
 * store.ts 의 로직·테스트를 그대로 두고 저장소만 바꾼다.
 * 이유: 무료 플랜에서 KV 는 쓰기·list 각 1,000/일인데 D1 은 쓰기 100,000/일,
 * 읽기 5,000,000/일 — 공용 서비스의 저장 한도 병목이 사실상 사라진다.
 *
 * - 테이블은 최초 접근 시 lazy 생성 (마이그레이션 파일 불필요)
 * - TTL 은 expires_at(unix 초) 로 저장, 조회 시 필터 (lazy 만료 — 실제 삭제는 안 해도
 *   저장량이 미미하고, 필요하면 나중에 cron 으로 청소)
 * - list 는 LIKE 프리픽스 검색 (%, _ 는 이스케이프)
 */
import type { KVNamespaceLike } from './store';

/** D1Database 의 우리가 쓰는 부분만 — @cloudflare/workers-types 의존 없이 */
export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

const INIT_SQL = `CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT,
  expires_at INTEGER
)`;

const now = () => Math.floor(Date.now() / 1000);

// isolate 당 한 번만 CREATE TABLE 을 실행하도록 어댑터를 캐시
const cache = new WeakMap<object, KVNamespaceLike>();

export function d1Store(db: D1Like): KVNamespaceLike {
  const cached = cache.get(db as object);
  if (cached) return cached;

  let ready: Promise<unknown> | null = null;
  const init = () => (ready ??= db.prepare(INIT_SQL).bind().run());

  const store: KVNamespaceLike = {
    async get(key) {
      await init();
      const row = await db
        .prepare('SELECT value FROM kv WHERE key = ?1 AND (expires_at IS NULL OR expires_at > ?2)')
        .bind(key, now())
        .first<{ value: string }>();
      return row ? row.value : null;
    },

    async put(key, value, options) {
      await init();
      const exp = options?.expirationTtl ? now() + options.expirationTtl : null;
      const meta = options?.metadata === undefined ? null : JSON.stringify(options.metadata);
      await db
        .prepare(
          'INSERT INTO kv (key, value, metadata, expires_at) VALUES (?1, ?2, ?3, ?4) ' +
            'ON CONFLICT(key) DO UPDATE SET value = ?2, metadata = ?3, expires_at = ?4',
        )
        .bind(key, value, meta, exp)
        .run();
    },

    async delete(key) {
      await init();
      await db.prepare('DELETE FROM kv WHERE key = ?1').bind(key).run();
    },

    async list(options) {
      await init();
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const pattern = prefix.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const { results } = await db
        .prepare(
          "SELECT key, metadata FROM kv WHERE key LIKE ?1 ESCAPE '\\' " +
            'AND (expires_at IS NULL OR expires_at > ?2) ORDER BY key LIMIT ?3',
        )
        .bind(pattern, now(), limit)
        .all<{ key: string; metadata: string | null }>();
      return {
        keys: results.map((r) => ({
          name: r.key,
          metadata: r.metadata === null ? undefined : (JSON.parse(r.metadata) as unknown),
        })),
      };
    },
  };

  cache.set(db as object, store);
  return store;
}
