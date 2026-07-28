/**
 * 결정론적 해시 + PRNG. 외부 의존성 없음.
 * 같은 입력 → 항상 같은 출력이 이 서비스 전체의 기반이다.
 */

/** FNV-1a 32bit 문자열 해시 */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 여러 파트(시드, 인덱스, 필드명 등)를 하나의 32bit 시드로 결합 */
export function combineSeed(...parts: Array<number | string>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? p.toString(36) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // 파트 경계 구분자 — ("ab","c") 와 ("a","bc") 가 같은 시드가 되는 것을 방지
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — 시드 하나로 [0,1) 수열 생성 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RNG {
  readonly seed: number;
  /** [0,1) */
  next(): number;
  /** 정수, 양 끝 포함 */
  int(min: number, max: number): number;
  /** 실수, [min, max) */
  float(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function createRNG(seed: number): RNG {
  const next = mulberry32(seed);
  return {
    seed,
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
