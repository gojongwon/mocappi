/**
 * 모듈 경계를 넘는 가변 상태 — 이것만 여기 둔다.
 *
 * ES 모듈의 import 바인딩은 읽기 전용이라 `WS = ...` 같은 재대입이 다른 모듈에 보이지 않는다.
 * 객체 프로퍼티 변경은 그 제약이 없으므로 접근자 함수 여덟 개 대신 객체 하나로 공유한다.
 *
 * 이름이 `state` 가 아닌 이유: GUI 편집 상태를 담는 지역 변수 `const state = readState()` 가
 * 여러 함수에 이미 있어서, 같은 이름이면 함수 안에서 조용히 가려진다.
 */
export const shared = {
  /**
   * 현재 워크스페이스 ID — null 이면 공용 풀(조회 전용).
   * @type {string | null} (초기값만 보면 tsc 가 null 로 굳혀서 테스트의 대입이 막힌다)
   */
  ws: null,
  /**
   * 불러오거나 방금 저장한 프리셋 — 짧은 URL 표시의 근거.
   * @type {{ sid: string, res: string, query: string, name: string } | null}
   */
  loadedPreset: null,
  /** 저장 프리셋을 처음 선택하기 직전의 편집 상태 — 선택 해제 시 복원용 */
  preloadSnapshot: null,
  /** 미리보기에 마지막으로 그린 원문 — 응답 복사 버튼이 쓴다 */
  lastPreviewText: '',
  /** 마지막 미리보기 응답에 프리셋 상태가 병합돼 있었나 (X-Mock-State: applied) — 상태 스트립의 근거 */
  stateApplied: false,
};
