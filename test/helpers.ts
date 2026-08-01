/** 테스트용 인메모리 KV — 워커가 쓰는 get/put/delete/list 만 재현한다. */
import type { KVNamespaceLike } from '../src/store';

export class MemKV implements KVNamespaceLike {
  store = new Map<string, { value: string; metadata?: unknown }>();

  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { metadata?: unknown }) {
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

/** 쓰기 횟수를 세는 MemKV — 중복 쓰기 스킵 검증용 */
export class CountingKV extends MemKV {
  puts = 0;

  override async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.puts++;
    await super.put(key, value, options);
  }
}
