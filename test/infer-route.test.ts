import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'https://mock.test';
const post = (body: string) =>
  worker.fetch(new Request(BASE + '/schema/infer', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));

describe('POST /schema/infer', () => {
  it('JSON 예시 → 필드 목록', async () => {
    const res = await post(JSON.stringify({ name: '김민준', age: 34, email: 'a@b.co' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Array<{ name: string; type: string }> };
    const t = Object.fromEntries(body.fields.map((f) => [f.name, f.type]));
    expect(t.name).toBe('person.fullName');
    expect(t.email).toBe('internet.email');
  });

  it('추론 결과를 그대로 /api 에 넣으면 200', async () => {
    const sample = { id: 42, customer: { name: '박서연', city: '부산' }, tags: ['a', 'b'], paidAt: '2025-06-01' };
    const inf = (await (await post(JSON.stringify(sample))).json()) as { fields: Array<{ name: string; type: string }> };
    const qs = inf.fields.map((f) => `${f.name}=${encodeURIComponent(f.type)}`).join('&');
    const res = await worker.fetch(new Request(`${BASE}/api/orders?${qs}&_limit=2`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    expect((body.data[0].customer as Record<string, unknown>).name).toBeTruthy();
  });

  it('깨진 JSON → 400 + 힌트', async () => {
    const res = await post('{oops');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Invalid JSON');
  });

  it('추론 불가 → 400', async () => {
    expect((await post('"문자열"')).status).toBe(400);
  });

  it('GET → 405, CORS 헤더에 POST 포함', async () => {
    const res = await worker.fetch(new Request(BASE + '/schema/infer'));
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
