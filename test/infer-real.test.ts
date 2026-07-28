/**
 * 실제 현장 API 응답 형태 회귀 테스트 —
 * 이중 envelope({data:{items:[...]}}), 항목별 null 다수, 객체 배열 포함.
 */
import { describe, expect, it } from 'vitest';
import { inferSchema } from '../src/infer';

const REAL = {
  data: {
    statistics: { total_technician: 26, measured_count: 0 },
    items: [
      {
        user_id: '019df1e4-eb3b-7684-9404-5ae33983db15',
        sequence: 1,
        name: '홍승완',
        phone: '01040021920',
        agency_name: '김밥회사2',
        technician_types: [],
        daily_cold_related_status: {
          is_active: true, status: 'asymptomatic',
          survey_id: '019fa660-4b95-7eb4-b7c9-ecd992f0e173',
          created_at: '2026-07-28T01:39:16.497033Z',
        },
        cold_related_status: null,
        cardiovascular_cuff: { sys: 118, dia: 81, measurement_type: 'cuff' },
        heart_rate: null,
        is_active: true,
        signup_type: 0,
        is_measured: false,
        smart_band_device: {
          smart_band_device_id: '019ed8e6-c1a9-7c89-94c0-fddd10396378',
          is_active: false,
        },
      },
      {
        user_id: '019ec45c-152f-75fc-88c4-1f84f49cae68',
        sequence: 2,
        name: '밥지',
        phone: '010654063523',
        agency_name: '전략기획팀',
        technician_types: [{ key: 'elderly', badge_name: '고령자' }],
        daily_cold_related_status: { is_active: true, status: 'no_response', survey_id: null, created_at: null },
        cold_related_status: null,
        cardiovascular_cuff: null,
        heart_rate: null,
        is_active: false,
        signup_type: 2,
        is_measured: false,
        smart_band_device: null,
      },
    ],
    page: 1,
    limit: 15,
    total: 26,
    total_pages: 2,
  },
};

describe('실제 응답 추론', () => {
  it('이중 envelope — data.items 배열을 찾아 추론', () => {
    const r = inferSchema(REAL);
    const t = Object.fromEntries(r.fields.map((f) => [f.name, f.type]));
    expect(t.user_id).toBe('uuid');
    expect(t.sequence).toBe('index');
    expect(t.name).toBe('person.fullName');
    expect(t.phone).toBe('phone.number');
    expect(t.is_active).toBe('bool');
    expect(t['cardiovascular_cuff.sys']).toMatch(/^int:/);
    expect(t['cardiovascular_cuff.measurement_type']).toBe('enum:cuff');
    expect(t['daily_cold_related_status.status']).toBe('enum:asymptomatic');
    // statistics/page 같은 envelope 메타는 항목 스키마에 안 들어감
    expect(t['statistics.total_technician']).toBeUndefined();
    expect(t.total_pages).toBeUndefined();
    expect(r.note).toContain('items');
  });

  it('null 병합 — 1번 항목에서 null 인 필드를 2번 항목이 보완 (역방향 포함)', () => {
    const r = inferSchema(REAL);
    const t = Object.fromEntries(r.fields.map((f) => [f.name, f.type]));
    // item[0] 의 survey_id 는 uuid, item[1] 은 null → uuid 로 추론돼야 함
    expect(t['daily_cold_related_status.survey_id']).toBe('uuid');
    expect(t['daily_cold_related_status.created_at']).toMatch(/^date:/);
    // item[1] 의 cardiovascular_cuff 는 null 이지만 item[0] 에 있음
    expect(t['cardiovascular_cuff.dia']).toMatch(/^int:/);
    // item[0] 의 smart_band_device 로 중첩 추론
    expect(t['smart_band_device.smart_band_device_id']).toBe('uuid');
  });

  it('전 항목 null / 객체 배열은 이유와 함께 제외', () => {
    const r = inferSchema(REAL);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));
    expect(reasons['cold_related_status']).toContain('null');
    expect(reasons['heart_rate']).toContain('null');
    // 빈 배열이 다른 항목의 non-empty 로 대체된 뒤 객체 배열로 판정
    expect(reasons['technician_types']).toContain('객체 배열');
  });

  it('추론 결과 전체가 유효한 쿼리스트링 → 200 응답', async () => {
    const { default: worker } = await import('../src/index');
    const r = inferSchema(REAL);
    const qs = r.fields.map((f) => `${f.name}=${encodeURIComponent(f.type)}`).join('&');
    const res = await worker.fetch(new Request(`https://mock.test/api/technicians?${qs}&_limit=3&_locale=ko`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(3);
    expect(body.data[0].name).toBeTruthy();
  });
});
