# <img src="./assets/logo.svg" height="30" alt="Mock API logo"> Mock API

[English](./README.md)

URL 만으로 스키마를 정의하는 팀 내부용 목(mock) REST API. 앱 설치도, PR도, 재배포도 없이 **URL만 고쳐 쓰면 된다.** 같은 URL은 항상 같은 데이터를 반환한다.

- GUI (URL 빌더 + 실시간 미리보기): `GET /`
- 데이터: `GET /api/<리소스명>?필드=타입&...`
- 지원 타입 목록: `GET /schema/types`
- JSON 예시 → 스키마 추론: `POST /schema/infer`
- 스키마 → TypeScript 타입: `GET /schema/ts` (GUI 의 "TS 타입 복사" 버튼)

**팀 배포 주소: <https://mock-api.gojongwon.workers.dev>** — 브라우저로 열면 GUI가 뜬다.

## 5분 시작

배포된 워커 주소를 열면 GUI가 뜬다. 프리셋(사용자/상품/주문) 버튼 → URL 복사 → 끝.
실제 API 응답 JSON이 있으면 **JSON 붙여넣기** 버튼에 그대로 붙여넣으면 필드와 타입이 자동 추론된다 (`{"data":[...]}` envelope 도 자동 언랩).
GUI 주소창 자체가 편집 상태이므로, 브라우저 주소를 복사해 팀원에게 보내면 같은 편집 화면이 열린다.

## 사용 예시

**1. 기본 — 한국어 사용자 목록**

```
/api/users?id=uuid&name=person.fullName&email=internet.email&age=int:20~60&_total=500&_limit=20
```

```json
{
  "data": [ { "id": "...", "name": "김민준", "email": "...", "age": 34 } ],
  "page": 1, "limit": 20, "total": 500, "totalPages": 25,
  "hasNext": true, "hasPrev": false
}
```

**2. 중첩 객체 + 배열**

```
/api/users?name=person.fullName&address.city=location.city&address.zip=location.zipCode&tags[]=lorem.word:3
```

→ `{ "address": { "city": "서울특별시", "zip": "04524" }, "tags": ["...", "...", "..."] }`

**3. 로딩 UI 테스트 — 3초 지연**

```
/api/products?name=commerce.productName&price=int:1000~99000&_delay=3000
```

**4. 에러 핸들링 테스트 — 500 강제**

```
/api/orders?id=uuid&_status=500
```

(상태코드만 바뀌고 본문은 그대로라 파싱 로직도 함께 테스트 가능)

**5. envelope 없이 배열만 + 영어 데이터**

```
/api/users?name=person.fullName&_wrap=none&_locale=en
```

## 예약 파라미터 (`_` 로 시작)

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `_page` | 1 | 페이지 번호 (1-base) |
| `_limit` | 10 | 페이지당 항목 수 (최대 100) |
| `_total` | 100 | 전체 항목 수 (가상) |
| `_seed` | URL 해시 | 명시하면 고정 시드 |
| `_locale` | ko | `ko` \| `en` |
| `_delay` | 0 | 응답 지연 ms (최대 5000) |
| `_status` | 200 | 강제 HTTP 상태코드 |
| `_wrap` | envelope | `envelope` \| `none`(배열만) |

`_` 로 시작하지 않는 파라미터는 전부 필드 정의다.

## 필드 타입 DSL

```
name=person.fullName          # faker 경로 (모듈.메서드)
age=int:20~60                 # 정수 범위
price=float:0~100:2           # 실수 범위 + 소수점 자릿수
active=bool:0.8               # true 확률 80%
role=enum:admin|user|guest    # 열거형 중 택1
type=const:user               # 고정 리터럴
bio=text:50                   # 지정 길이 문자열
avatar=image:200x200          # placeholder 이미지 URL
createdAt=date:2020-01-01~2024-12-31
id=uuid
seq=index                     # 전역 인덱스 (0,1,2…) — 페이지 검증에 유용
address.city=location.city    # 점 표기법 → 중첩 객체
tags[]=lorem.word:3           # 배열 — 값의 마지막 :정수 가 길이 (기본 3)
```

전체 목록과 faker 경로는 `GET /schema/types`. 잘못 쓰면 400 응답이 무엇이 왜 틀렸는지 알려준다:

```json
{ "error": "Invalid int range", "field": "age", "value": "int:20-60",
  "hint": "범위 구분자는 '~' 입니다. 예: int:20~60" }
```

## 워크스페이스 — 공개 운영 시 저장 공간 분리

여러 팀/외부 사용자가 한 서버를 쓸 때는 **워크스페이스**로 저장 공간을 분리한다.
**저장은 워크스페이스에서만 가능하다** (공용 풀은 조회 전용). 헤더의 저장소 버튼 → "새 워크스페이스 만들기" → 발급된 링크(`/?_ws=<ID>`)를 팀에 공유.
링크를 아는 사람만 그 워크스페이스의 프리셋 목록을 볼 수 있다 (capability URL 모델, 로그인 없음).

- 짧은 URL 형식: `?_s=<ws>.<id>` (공용 풀은 `?_s=<id>` — 기존 URL 그대로 동작)
- 워크스페이스당 최대 100개, 저장물은 180일간 사용이 없으면 만료 (재저장 시 갱신). 공용 풀은 무기한
- 링크 분실 = 접근 불가이므로 워크스페이스 링크는 팀 문서에 보관할 것

### 공개 운영 체크리스트

- Cloudflare 대시보드 → Security → WAF 에서 `/schema/save` rate limiting rule 추가 권장
- 사용량 알림 설정 (Workers 무료 100K req/일, KV 쓰기 1K/일)
- 트래픽 증가 시 Workers Paid($5/월) 전환

## 팀 스키마 저장 (선택 기능)

GUI 의 **팀에 저장** 버튼으로 현재 스키마를 팀 전체가 쓸 수 있게 저장한다.
저장하면 짧은 URL 이 생기고(`/api/users?_s=aB3xK9`), 상단 "팀 프리셋" 목록에서 누구나 불러올 수 있다.

- **불변(content-addressed)**: 저장 내용의 해시가 ID. 같은 스키마 = 같은 ID, 고쳐서 다시 저장하면 새 ID.
  한 번 공유된 `_s=` URL 은 영원히 같은 데이터를 반환한다.
- **오버라이드**: `?_s=aB3xK9&_page=2&_limit=50` 처럼 저장본 위에 파라미터를 덮어쓸 수 있다.
- API: `POST /schema/save` {name, res, query} · `GET /schema/saved` · `GET|DELETE /schema/saved/:id`

### 팀 저장 활성화 (1회)

```bash
npx wrangler kv namespace create SCHEMAS
# 출력된 id 를 wrangler.toml 의 [[kv_namespaces]] 블록에 붙여넣고 주석 해제
npm run deploy
```

KV 를 연결하지 않아도 나머지 기능은 전부 정상 동작한다 (저장 UI 만 자동으로 숨겨짐).
무료 티어: 읽기 10만/일, 쓰기 1천/일 — 팀 사용에 충분.

## TypeScript 타입

GUI 의 **TS 타입 복사** 버튼(또는 `GET /schema/ts?<스키마>&_res=리소스명`)이 현재 스키마의 interface,
제네릭 envelope(`Paginated<T>`), fetch 헬퍼를 복사해준다. `enum:a|b|c` 은 리터럴 유니언으로 변환된다.

```ts
const res = await fetchMock<User>(url);
res.data[0].name; // 자동완성 + 타입 체크
```

## 결정론 (스냅샷 테스트 안정성)

- 같은 URL → 항상 같은 응답 (바이트 단위 동일)
- 항목별 시드: 전역 `i`번째 항목은 `_limit`/`_page` 를 바꿔도 동일하다.
  (`_limit=10&_page=2` 의 1번째 == `_limit=20&_page=1` 의 11번째)
- 필드 순서만 다른 URL, `_delay`/`_status` 만 다른 URL → 같은 데이터
- faker `date.*` 계열은 refDate 를 `2026-01-01` 로 고정해 시간이 지나도 값이 변하지 않는다.

주의: faker 라이브러리 버전을 올리면 생성 값이 바뀔 수 있다. 스냅샷을 쓰는 동안은 버전을 고정할 것.

## 개발

```bash
npm install
npm test            # vitest — 결정론/DSL/워커 54개 테스트
npm run typecheck
npm run dev         # wrangler dev → http://localhost:8787
npm run size        # 번들 gzip 크기 (Workers 무료 플랜 제한 3MB)
npm run deploy      # wrangler deploy (Cloudflare 로그인 필요)
```

배포: `npx wrangler login` 후 `npm run deploy`. 무료 플랜 100K req/일 — 10명 팀 기준 여유가 크다.

## 구조

```
src/
  index.ts     # 라우터 (/, /api/:resource, /schema/types) + CORS + _delay/_status
  dsl.ts       # 쿼리스트링 → 스키마 파싱 + 친절한 에러
  registry.ts  # 타입 레지스트리 (타입명 → 생성 함수) + /schema/types 문서
  generate.ts  # 항목별 시드 생성 + 페이지네이션
  rng.ts       # FNV-1a 해시 + mulberry32 PRNG
  gui.html     # 단일 파일 GUI
test/          # dsl / determinism / worker 테스트
```

## v1 에서 뺀 것 (의도적)

스키마 저장(KV), 쓰기 API(CRUD), 인증. 실사용에서 필요가 확인되면 v2로.
