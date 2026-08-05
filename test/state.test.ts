/**
 * 프리셋 상태 — 워크스페이스 프리셋의 쓰기가 다음 GET 에 보인다.
 * TanStack Query 의 "mutation → invalidateQueries → refetch" 흐름 그대로 검증한다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { MemKV } from './helpers';

const BASE = 'https://mock.test';
const kv = new MemKV();
const env = { SCHEMAS: kv };

let ipSeq = 0;
const req = (path: string, init?: RequestInit) =>
  worker.fetch(
    new Request(BASE + path, {
      ...init,
      // 저장 리미터(10/시간)를 피해 호출마다 다른 IP — 상태 리미터(240/시간)와는 무관
      headers: { 'cf-connecting-ip': `10.0.0.${++ipSeq}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
    env,
  );

const jsonOf = async <T>(r: Response) => (await r.json()) as T;
type Env = { data: Array<Record<string, unknown>>; total: number };

let sid = '';

beforeAll(async () => {
  const res = await req('/schema/save', {
    method: 'POST',
    body: JSON.stringify({ ws: 'team01demo', name: '상태 테스트', res: 'users', query: 'id=uuid&name=person.fullName&age=int:20~60&_total=20' }),
  });
  expect(res.status).toBe(200);
  sid = (await jsonOf<{ sid: string }>(res)).sid;
  expect(sid).toContain('.');
});

describe('생성 → 목록 반영', () => {
  it('POST(JSON 바디) → 201 + 보낸 값이 병합된 완성 아이템', async () => {
    const res = await req(`/api/users?_s=${sid}`, { method: 'POST', body: JSON.stringify({ name: '홍길동' }) });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-mock-state')).toBe('applied'); // 상태에 반영됐음을 헤더로
    const item = await jsonOf<Record<string, unknown>>(res);
    expect(item.name).toBe('홍길동'); // 보낸 값 그대로
    expect(typeof item.id).toBe('string'); // 안 보낸 필드는 스키마 기본값
    expect(typeof item.age).toBe('number');
  });

  it('refetch 하면 목록 맨 앞에 나타나고 total 이 는다', async () => {
    const res = await req(`/api/users?_s=${sid}`);
    expect(res.headers.get('cache-control')).toBe('no-store'); // 상태 프리셋은 캐시 금지
    const body = await jsonOf<Env>(res);
    expect(body.total).toBe(21);
    expect(body.data[0].name).toBe('홍길동');
    expect(res.headers.get('x-total-count')).toBe('21');
  });

  it('_wrap=one + 경로 id → 생성한 아이템의 상세', async () => {
    const list = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const created = list.data[0];
    const res = await req(`/api/users/${created.id}?_s=${sid}&_wrap=one`);
    const item = await jsonOf<Record<string, unknown>>(res);
    expect(item.name).toBe('홍길동');
    expect(item.id).toBe(created.id);
  });

  it('_q 검색에도 생성한 아이템이 걸린다', async () => {
    const body = await jsonOf<Env>(await req(`/api/users?_s=${sid}&_q=${encodeURIComponent('홍길동')}`));
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((d) => d.name === '홍길동')).toBe(true);
  });
});

describe('수정·삭제 → 목록 반영', () => {
  it('PATCH /경로/<기본 아이템 id> → 해당 필드만 바뀐다', async () => {
    const before = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const target = before.data[1]; // 0번은 생성물 — 기본 아이템을 고른다
    const res = await req(`/api/users/${target.id}?_s=${sid}`, { method: 'PATCH', body: JSON.stringify({ age: 99 }) });
    expect(res.status).toBe(200);
    expect((await jsonOf<Record<string, unknown>>(res)).age).toBe(99);

    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const patched = after.data.find((d) => d.id === target.id)!;
    expect(patched.age).toBe(99);
    expect(patched.name).toBe(target.name); // 나머지 필드는 그대로
  });

  it('DELETE /경로/<기본 아이템 id> → 204, 목록에서 사라지고 total 감소', async () => {
    const before = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const target = before.data[2];
    expect((await req(`/api/users/${target.id}?_s=${sid}`, { method: 'DELETE' })).status).toBe(204);

    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    expect(after.total).toBe(before.total - 1);
    expect(after.data.some((d) => d.id === target.id)).toBe(false);
  });

  it('PUT — 통째 교체: 안 보낸 필드가 사라진다 (PATCH 와 의미가 다르다)', async () => {
    const before = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const target = before.data[3];
    const res = await req(`/api/users/${target.id}?_s=${sid}`, { method: 'PUT', body: JSON.stringify({ name: '교체본' }) });
    expect(res.status).toBe(200);
    const item = await jsonOf<Record<string, unknown>>(res);
    expect(item.name).toBe('교체본');
    expect(item.id).toBe(target.id); // 정체성은 유지
    expect('age' in item).toBe(false); // 안 보낸 필드는 사라진다

    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const replaced = after.data.find((d) => d.id === target.id)!;
    expect('age' in replaced).toBe(false);
  });

  it('PUT 뒤 PATCH — 패치는 교체본 위에 얹힌다', async () => {
    const list = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const target = list.data.find((d) => d.name === '교체본')!;
    await req(`/api/users/${target.id}?_s=${sid}`, { method: 'PATCH', body: JSON.stringify({ age: 7 }) });
    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const item = after.data.find((d) => d.id === target.id)!;
    expect(item.name).toBe('교체본');
    expect(item.age).toBe(7);
  });

  it('삭제된 아이템은 수정도 404 — 실제 API 처럼', async () => {
    const list = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const missing = 'ffffffff-0000-4000-8000-000000000000';
    expect(list.data.some((d) => d.id === missing)).toBe(false);
    const res = await req(`/api/users/${missing}?_s=${sid}`, { method: 'PATCH', body: JSON.stringify({ age: 1 }) });
    expect(res.status).toBe(404);
    expect((await jsonOf<{ error: string }>(res)).error).toBe('Not Found');
  });

  it('생성한 아이템 DELETE → 생성 전으로', async () => {
    const created = (await jsonOf<Env>(await req(`/api/users?_s=${sid}`))).data[0];
    expect(created.name).toBe('홍길동');
    expect((await req(`/api/users/${created.id}?_s=${sid}`, { method: 'DELETE' })).status).toBe(204);
    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    expect(after.data.some((d) => d.name === '홍길동')).toBe(false);
  });
});

describe('상태가 생기지 않는 경우 — 결정성 보호', () => {
  it('바디 없는 POST 는 상태를 만들지 않는다 (GUI 미리보기 안전)', async () => {
    const before = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    const res = await req(`/api/users?_s=${sid}`, { method: 'POST' });
    expect(res.status).toBe(201); // 기존 무상태 응답 그대로
    expect(res.headers.get('x-mock-state')).toBe('stateless'); // 반영 안 됐음도 헤더로
    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    expect(after.total).toBe(before.total);
  });

  it('_method=post 링크(실제 GET)로는 상태가 안 바뀐다', async () => {
    const before = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    await req(`/api/users?_s=${sid}&_method=post`);
    const after = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    expect(after.total).toBe(before.total);
  });

  it('순수 쿼리 URL 의 쓰기는 지금처럼 무상태·캐시 유지', async () => {
    const url = '/api/users?id=uuid&name=person.fullName&_total=5';
    const w = await req(url, { method: 'POST', body: JSON.stringify({ name: '아무개' }) });
    expect(w.headers.get('x-mock-state')).toBe('stateless');
    const res = await req(url);
    expect((await jsonOf<Env>(res)).total).toBe(5);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('깨진 JSON 바디 → 400', async () => {
    const res = await req(`/api/users?_s=${sid}`, { method: 'POST', body: '{oops' });
    expect(res.status).toBe(400);
  });
});

describe('id 필드가 없는 스키마', () => {
  let logSid = '';
  beforeAll(async () => {
    const res = await req('/schema/save', {
      method: 'POST',
      body: JSON.stringify({ ws: 'team01demo', name: '로그', res: 'logs', query: 'msg=lorem.word&_total=5' }),
    });
    logSid = (await jsonOf<{ sid: string }>(res)).sid;
  });

  it('생성물에는 id 가 주입돼 수정·삭제가 된다', async () => {
    const item = await jsonOf<Record<string, unknown>>(
      await req(`/api/logs?_s=${logSid}`, { method: 'POST', body: JSON.stringify({ msg: '첫 로그' }) }),
    );
    expect(typeof item.id).toBe('string');
    const patched = await req(`/api/logs/${item.id}?_s=${logSid}`, { method: 'PATCH', body: JSON.stringify({ msg: '고침' }) });
    expect(patched.status).toBe(200);
    expect((await jsonOf<Record<string, unknown>>(patched)).msg).toBe('고침');
  });

  it('기본 아이템 수정은 400 + id 필드 안내', async () => {
    const res = await req(`/api/logs/nope123?_s=${logSid}`, { method: 'PATCH', body: JSON.stringify({ msg: 'x' }) });
    expect(res.status).toBe(400);
    expect((await jsonOf<{ hint: string }>(res)).hint).toContain('id');
  });
});

describe('바디 검증 — 타입까지만, 값은 안 본다', () => {
  let vSid = '';
  beforeAll(async () => {
    const res = await req('/schema/save', {
      method: 'POST',
      body: JSON.stringify({
        ws: 'team01demo', name: '검증', res: 'orders',
        query: 'id=uuid&amount=int:1000~90000&paid=bool&tags[]=lorem.word:2&customer.name=person.fullName&_total=10',
      }),
    });
    vSid = (await jsonOf<{ sid: string }>(res)).sid;
  });

  it('스키마 필드의 타입 불일치 → 400 + 폼 입력 힌트', async () => {
    const res = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ amount: '9000' }) });
    expect(res.status).toBe(400);
    const b = await jsonOf<{ error: string; field: string; hint: string }>(res);
    expect(b.error).toBe('Type mismatch');
    expect(b.field).toBe('amount');
    expect(b.hint).toContain('폼'); // input 값은 항상 문자열 — 고전 버그를 짚어준다
  });

  it('값 범위·enum 은 검사하지 않는다 — 생성 규칙이지 검증 규칙이 아니다', async () => {
    const res = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ amount: 5 }) });
    expect(res.status).toBe(201); // int:1000~90000 밖이어도 타입(number)이 맞으면 통과
    expect((await jsonOf<Record<string, unknown>>(res)).amount).toBe(5);
  });

  it('스키마에 없는 필드는 조용히 제외 — password 가 entity 에 안 샌다', async () => {
    const res = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ paid: true, password: 'secret!' }) });
    expect(res.status).toBe(201);
    const item = await jsonOf<Record<string, unknown>>(res);
    expect(item.paid).toBe(true);
    expect('password' in item).toBe(false);
    const list = await jsonOf<Env>(await req(`/api/orders?_s=${vSid}`));
    expect(list.data.every((d) => !('password' in d))).toBe(true);
  });

  it('중첩 객체·배열 요소의 타입도 검증한다', async () => {
    const nested = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ customer: 'text' }) });
    expect(nested.status).toBe(400); // customer 는 object 여야 한다
    const arr = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ tags: ['a', 1] }) });
    expect(arr.status).toBe(400); // tags[] 요소는 string
    const ok = await req(`/api/orders?_s=${vSid}`, { method: 'POST', body: JSON.stringify({ customer: { name: '박서연' }, tags: ['a'] }) });
    expect(ok.status).toBe(201);
  });

  it('PUT·PATCH 도 같은 규칙', async () => {
    const list = await jsonOf<Env>(await req(`/api/orders?_s=${vSid}`));
    const id = list.data.find((d) => typeof d.id === 'string' && !('password' in d))!.id;
    const res = await req(`/api/orders/${id}?_s=${vSid}`, { method: 'PUT', body: JSON.stringify({ paid: 'yes' }) });
    expect(res.status).toBe(400);
    expect((await jsonOf<{ field: string }>(res)).field).toBe('paid');
  });
});

describe('상태 조회·초기화', () => {
  it('GET /schema/state/<sid> → 현재 오버레이', async () => {
    const body = await jsonOf<{ state: { updated: Record<string, unknown>; deleted: string[] } }>(
      await req(`/schema/state/${sid}`),
    );
    expect(Object.keys(body.state.updated).length).toBeGreaterThanOrEqual(1);
    expect(body.state.deleted.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /schema/state/<sid> → 기본 데이터로 복귀', async () => {
    expect((await jsonOf<{ ok: boolean }>(await req(`/schema/state/${sid}`, { method: 'DELETE' }))).ok).toBe(true);
    const body = await jsonOf<Env>(await req(`/api/users?_s=${sid}`));
    expect(body.total).toBe(20);
  });

  it('공용 풀/순수 sid 는 상태 대상이 아니다 → 400', async () => {
    expect((await req('/schema/state/ab12cd34ef')).status).toBe(400);
  });
});
