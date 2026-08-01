/**
 * Accept-Language 기반 서버 발신 문자열 한/영 이중화.
 * - 헤더 없음 → ko (하위호환), ko* → ko, 그 외 → en
 * - 응답 JSON 의 키는 hint 하나만 (hintEn 키 노출 금지)
 * - 언어는 시드/데이터에 영향을 주지 않는다
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const get = (path: string, acceptLanguage?: string) =>
  worker.fetch(new Request(BASE + path, acceptLanguage === undefined ? undefined : { headers: { 'accept-language': acceptLanguage } }));

describe('400 힌트 언어 선택', () => {
  it('Accept-Language: en → 영어 힌트 (range separator)', async () => {
    const res = await get('/api/users?age=int:20-60', 'en');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; hint: string; hintEn?: string };
    expect(body.field).toBe('age');
    expect(body.hint).toContain('range separator');
    expect(body.hint).not.toMatch(/[가-힣]/);
    expect(body).not.toHaveProperty('hintEn'); // 키는 hint 하나만
  });

  it('헤더 없음 → 한국어 힌트 (범위 구분자, 하위호환)', async () => {
    const res = await get('/api/users?age=int:20-60');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain('범위 구분자');
    expect(body).not.toHaveProperty('hintEn');
  });

  it('실제 브라우저 헤더 형태 — en-US,en;q=0.9 → en / ko-KR,ko;q=0.9 → ko', async () => {
    const en = (await (await get('/api/users?age=int:20-60', 'en-US,en;q=0.9')).json()) as { hint: string };
    expect(en.hint).toContain('range separator');
    const ko = (await (await get('/api/users?age=int:20-60', 'ko-KR,ko;q=0.9')).json()) as { hint: string };
    expect(ko.hint).toContain('범위 구분자');
  });
});

describe('/schema/types 라벨 언어', () => {
  it('en → fakerPaths 라벨 영어, 구조(개수·value) 동일', async () => {
    const res = await get('/schema/types', 'en');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reserved: Array<{ name: string; desc: string }>;
      fakerPaths: Array<{ value: string; label: string }>;
      dslTypes: unknown[];
    };
    expect(body.reserved.length).toBe(15);
    const fullName = body.fakerPaths.find((f) => f.value === 'person.fullName');
    expect(fullName?.label).toBe('Full name');
    expect(JSON.stringify(body.fakerPaths.map((f) => f.value))).not.toMatch(/[가-힣]/);
  });

  it('ko(기본) → 기존 한국어 라벨 그대로', async () => {
    const body = (await (await get('/schema/types')).json()) as { fakerPaths: Array<{ value: string; label: string }> };
    expect(body.fakerPaths.find((f) => f.value === 'person.fullName')?.label).toBe('이름(전체)');
  });

  it('ko/en 구조 동일 — 키·개수·value/name 이 완전히 일치', async () => {
    const ko = (await (await get('/schema/types')).json()) as Record<string, unknown>;
    const en = (await (await get('/schema/types', 'en')).json()) as Record<string, unknown>;
    expect(Object.keys(en)).toEqual(Object.keys(ko));
    const shape = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(shape)
        : v && typeof v === 'object'
          ? Object.keys(v as Record<string, unknown>).sort()
          : typeof v;
    expect(shape(en)).toEqual(shape(ko));
  });
});

describe('/schema/ts 주석 언어', () => {
  it('en → 생성 코드에 한국어 없음', async () => {
    for (const wrap of ['envelope', 'none', 'one']) {
      const res = await get(`/schema/ts?_res=users&id=uuid&name=person.fullName&_wrap=${wrap}`, 'en');
      expect(res.status).toBe(200);
      const ts = await res.text();
      expect(ts, `_wrap=${wrap}`).not.toMatch(/[가-힣]/);
      expect(ts).toContain('export interface User');
    }
  });

  it('헤더 없음 → 기존 한국어 주석 유지', async () => {
    const ts = await (await get('/schema/ts?_res=users&id=uuid')).text();
    expect(ts).toContain('자동 생성된 타입');
  });
});

describe('언어와 데이터 결정성', () => {
  it('Accept-Language 는 생성 데이터에 영향 없음 (시드 밖)', async () => {
    const url = '/api/users?id=uuid&name=person.fullName&_total=20&_limit=5';
    const ko = await (await get(url)).text();
    const en = await (await get(url, 'en-US,en;q=0.9')).text();
    expect(en).toBe(ko);
  });
});
