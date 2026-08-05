# <img src="./assets/logo.svg" height="30" alt="mocappi logo"> mocappi

[English](./README.md)

URL 만으로 스키마를 정의하는 팀 내부용 목(mock) REST API. 앱 설치도, PR도, 재배포도 없이 **URL만 고쳐 쓰면 된다.** 같은 URL은 항상 같은 데이터를 반환한다.

- GUI (URL 빌더 + 실시간 미리보기): `GET /`
- 데이터: `GET | POST | PUT | PATCH | DELETE /api/<리소스명>?필드=타입&...`
- 지원 타입 목록: `GET /schema/types`
- JSON 예시 → 스키마 추론: `POST /schema/infer` (OpenAPI/Swagger 문서를 보내면 스펙 임포트)
- 스키마 → TypeScript 타입: `GET /schema/ts` (GUI 의 "TS 타입 복사" 버튼)

**팀 배포 주소: <https://mocappi.gojongwon.workers.dev>** — 브라우저로 열면 GUI가 뜬다.

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
→ 500 { "error": "Internal Server Error", "status": 500, "message": "서버에서 오류가 발생했습니다." }
```

**5. envelope 없이 배열만 + 영어 데이터**

```
/api/users?name=person.fullName&_wrap=none&_locale=en
```

**6. 검색과 정렬 — 데이터는 그대로, 필터와 순서만**

```
/api/users?name=person.fullName&age=int:20~60&_q=김            # 값 부분일치, total 은 매치 수
/api/users?name=person.fullName&age=int:20~60&_q=김&_qin=name   # name 필드만 검색
/api/users?name=person.fullName&age=int:20~60&_sort=-age,name   # 나이 내림차순, 동률은 이름순
```

`_q`·`_sort` 는 시드에 들어가지 않는다 — i번째 아이템 자체는 검색·정렬 유무와 무관하게 늘 같고,
바뀌는 건 어느 아이템이 어느 순서로 나오는지다. 둘 다 **앞 1,000개 창** 안에서 동작한다
(CPU 예산 때문). `_total` 이 그보다 크면 `total` 은 창 안 개수가 된다.
빈 값(`null`)은 오름/내림 어느 쪽이든 항상 뒤로 간다.

## HTTP 메서드

요청 바디는 보지 않는다 — 목이 돌려줘야 하는 건 **메서드에 맞는 응답 모양과 상태코드**다.

| 메서드 | 상태 | 바디 |
|---|---|---|
| `GET` / `HEAD` | 200 | 목록 (`_wrap` 에 따라) |
| `POST` | 201 | 생성된 단건 |
| `PUT` / `PATCH` | 200 | 수정된 단건 |
| `DELETE` | 204 | 없음 |

쓰기 메서드가 돌려주는 단건은 같은 스키마 `GET` 목록의 0번 아이템과 바이트까지 같다 —
메서드는 모양만 바꾸고 데이터는 건드리지 않는다.

생성된 URL 은 메서드 중립이다 — 메서드는 쿼리가 아니라 요청에서 온다.
GUI 에서 메서드를 고르면 그 verb 로 실제 요청을 보내고, 복사해 가는 URL 은 깨끗하게 남는다.

```
curl -X POST /api/users?name=person.fullName      # 201 + 단건
```

`_method` 는 손으로 URL 을 쓸 때의 탈출구다. 실제 verb 보다 우선하므로 브라우저 주소창의
평범한 GET 으로도 POST 응답을 볼 수 있다.

```
/api/users?name=person.fullName&_method=post      # 같은 응답, 평범한 GET
```

## 리소스 간 관계

`pk`/`ref` 는 리소스 사이의 외래 키를 맞물리게 한다 — 저장소도, 상대 URL 조회도 없이.
양쪽 다 리소스 이름과 항목 인덱스에서만 값을 파생하므로, 서로 본 적 없는 두 URL 이 영원히 일치한다:

```
/api/users?id=pk:users&name=person.fullName                 # id: 인덱스별 결정적 uuid
/api/orders?id=uuid&userId=ref:users&amount=int:1000~90000  # userId ∈ users 앞 100개의 id
```

모든 `orders[i].userId` 는 `users` 목록의 `id` 값 중 정확히 하나다. 어느 쪽이든 다른 필드를
더하거나 빼도 관계는 깨지지 않는다 (`pk` 는 일부러 자기 스키마의 나머지를 무시한다).
`ref:users:500` 은 풀을 앞 500개로 넓힌다 — 대상 리소스의 `_total` 과 맞추면 된다.
단건 모양과도 그대로 조합된다: `_wrap=one`, 쓰기 메서드, 배열(`viewers[]=ref:users:2`).

## 실패 응답

`_status` 가 400 이상이면 데이터 대신 실패 바디가 나간다.

```
/api/users?name=person.fullName&_status=404
→ 404 { "error": "Not Found", "status": 404, "message": "요청을 처리하지 못했습니다." }
```

`error` 는 **모든 표준 4xx/5xx** 의 reason phrase 다 (`413` → `Payload Too Large`,
`451` → `Unavailable For Legal Reasons`, …). 비표준 코드만 `Error` 로 떨어진다.
`message` 는 클래스당 한 문장 — 4xx 는 "요청을 처리하지 못했습니다", 5xx 는 "서버에서 오류가 발생했습니다".

직접 정의하려면 `_body` (JSON 원문, 최대 2000자, `_status` ≥ 400 일 때만):

```
/api/users?name=person.fullName&_status=401&_body={"code":"E_AUTH","message":"토큰 만료"}
→ 401 { "code": "E_AUTH", "message": "토큰 만료" }
```

실패가 최우선이다 — `_format=csv` 여도, `DELETE` 여도 JSON 실패 바디가 나간다.
400 미만(예: `_status=302`)은 기존대로 데이터를 그대로 두고 코드만 바꾼다.
`_body` 안에는 리터럴 `&` 를 쓸 수 없다 (프리셋 저장 시 쿼리가 쪼개진다) — JSON 안에서 `&` 로 쓴다.

## 예약 파라미터 (`_` 로 시작)

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `_page` | 1 | 페이지 번호 (1-base) |
| `_limit` | 10 | 페이지당 항목 수 (최대 100) |
| `_total` | 100 | 전체 항목 수 (가상) |
| `_seed` | URL 해시 | 명시하면 고정 시드 |
| `_locale` | ko | `ko` \| `en` \| `ja` \| `zh` |
| `_delay` | 0 | 응답 지연 ms (최대 5000) |
| `_status` | 200 | 강제 HTTP 상태코드. 400 이상이면 데이터 대신 실패 바디 |
| `_method` | 실제 verb | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` — 명시하면 실제 verb 보다 우선 |
| `_body` | — | 실패 응답 바디 (JSON 원문, 최대 2000자). `_status` ≥ 400 일 때만 |
| `_wrap` | envelope | `envelope` \| `none`(배열만) \| `one`(단일 객체 — 상세 API 용) |
| `_format` | json | `json` \| `ndjson` \| `csv` — ndjson/csv 는 아이템만 스트리밍 |
| `_q` | — | 검색 — 모든 값 부분일치(대소문자 무시), `total` 은 매치 수 (앞 1,000개 창) |
| `_qin` | — | 검색 대상 필드 한정 (쉼표, 중첩은 `a.b`) — `_q` 와 함께. 예: `_q=김&_qin=name` |
| `_sort` | — | 정렬 (쉼표, `-` 는 내림차순, 중첩은 `a.b`). 예: `_sort=name,-age` (앞 1,000개 창) |
| `_alias` | — | 예약 키를 실제 API 이름으로: `_alias=page:_page,size:_limit,keyword:_q` → `?page=2&size=20&keyword=김` 으로 호출 |

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
sku=pattern:ORD-####-???      # 패턴 — #숫자 ?대문자 *영숫자
                              #   (URL 을 직접 쓸 땐 # 를 %23 으로 — GUI 는 자동 인코딩)
status=enum:paid*8|refund*2   # 가중치 택1
email=internet.email?0.2      # 20% 확률 null — 모든 타입 뒤에 ?확률
name=mask.name                # 마스킹된 개인정보 — "김*준"
tel=mask.phone                #   "010-****-5678" (email·card 도 지원)
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

- 저장 레이트리밋은 **저장소에 포함돼 있다** — `wrangler.toml` 의 Workers Rate Limiting 바인딩(`SAVE_RL`, 버스트 방어)이 `workers.dev` 에서도 동작하며 배포하면 자동 활성화되고, 워커 자체에 **IP당 시간당 10회** 상한이 있다 (초과 시 429 + 차단 안내). 동일 내용 재저장의 중복 쓰기 스킵도 내장. 대시보드 설정 불필요.
  - zone WAF 레이트리밋 룰은 커스텀 도메인으로 서비스할 때만 가능한 선택적 추가 계층.
- 사용자 피드백 읽기 (GUI 피드백 버튼 → KV 저장, 90일 보관):

  ```bash
  npx wrangler d1 execute mock-api --remote --command "SELECT value FROM kv WHERE key LIKE 'fb:%' ORDER BY key DESC"
  ```

- 사용량 알림 설정 (Workers 무료 100K req/일, KV 쓰기 1K/일)
- 트래픽 증가 시 Workers Paid($5/월) 전환

## 팀 스키마 저장 (선택 기능)

GUI 의 **프리셋으로 저장** 버튼으로 현재 스키마를 팀 전체가 쓸 수 있게 저장한다.
저장하면 짧은 URL 이 생기고(`/api/users?_s=aB3xK9`), 상단 "저장된 프리셋" 목록에서 누구나 불러올 수 있다.

- **불변(content-addressed)**: 저장 내용의 해시가 ID. 같은 스키마 = 같은 ID, 고쳐서 다시 저장하면 새 ID.
  한 번 공유된 `_s=` URL 은 영원히 같은 데이터를 반환한다.
- **삭제**: 상단 프리셋 드롭다운을 열면 각 항목 오른쪽에 ✕ 가 있다 (확인 창 한 번).
  수정은 제자리에서 안 된다 (ID 가 내용의 해시라서) — 고친 걸 새 프리셋으로 저장하고 옛것을 ✕ 로 지우면 된다.
- **오버라이드**: `?_s=aB3xK9&_page=2&_limit=50` 처럼 저장본 위에 파라미터를 덮어쓸 수 있다.
- API: `POST /schema/save` {name, res, query} · `GET /schema/saved` · `GET|DELETE /schema/saved/:id`

### 팀 저장 활성화 (1회)

**권장 — D1** (무료 쓰기 100,000/일, KV 의 100배):

```bash
npx wrangler d1 create mock-api
# 출력된 database_id 를 wrangler.toml 의 [[d1_databases]] 주석 블록에 붙여넣고 주석 해제
npm run deploy
```

테이블은 최초 사용 시 자동 생성된다. KV(`SCHEMAS` 바인딩)는 폴백으로 계속 지원 — 둘 다 있으면 D1 우선.
기존 KV 데이터는 자동 이전되지 않으니 프리셋이 몇 개 없으면 다시 저장하면 된다.
저장소를 연결하지 않아도 나머지 기능은 전부 정상 동작한다 (저장 UI 만 자동으로 숨겨짐).

## 내보내기

URL 옆 **내보내기** 메뉴에서 현재 스키마를 다섯 가지로 복사한다.

| 항목 | 나오는 것 |
|---|---|
| `curl` | `curl -X POST 'https://…'` — 붙여넣으면 바로 도는 명령 |
| `fetch (JS)` | `await fetch(url)` + `res.json()` |
| `Python requests` | `requests.get(url).json()` |
| `TS 타입` | 아래 절 |
| `OpenAPI` | 아래 절 |

**호출 스니펫은 URL 복사와 다르다** — URL 은 메서드 중립이라 (GUI 는 URL 이 아니라 실제 verb 로
요청을 보낸다) POST 를 골라도 URL 만으로는 재현이 안 된다. 스니펫은 `-X POST` 까지 담는다.
`DELETE` 는 204 무본문이라 응답 파싱 없이 상태코드만 찍는다.

## TypeScript 타입

**내보내기 → TS 타입**(또는 `GET /schema/ts?<스키마>&_res=리소스명`)이 현재 스키마의 interface,
제네릭 envelope(`Paginated<T>`), fetch 헬퍼를 복사해준다. `enum:a|b|c` 은 리터럴 유니언으로 변환된다.

```ts
const res = await fetchMock<User>(url);
res.data[0].name; // 자동완성 + 타입 체크
```

## OpenAPI

TypeScript 를 안 쓴다면 **내보내기 → OpenAPI**(또는 `GET /schema/openapi?<스키마>&_res=리소스명`)가
같은 스키마를 OpenAPI 3.1 문서로 내보낸다. Postman·Insomnia 에 그대로 임포트하거나
`openapi-generator` 류로 원하는 언어의 클라이언트를 뽑을 수 있다.

```bash
curl 'https://mocappi.gojongwon.workers.dev/schema/openapi?_res=users&id=uuid&name=person.fullName&_total=500' > users.json
```

- 필드 파라미터의 `default` 가 문서를 만든 URL 그대로라, 임포트 직후 바로 호출된다
- `enum:paid*8|refund*2` → `enum: [paid, refund]` (가중치는 확률이라 뺀다),
  `internet.email?0.2` → `type: [string, null]` (3.1 방식)
- 필드마다 실제 생성값이 `examples` 로 들어가고, `_locale` 을 따른다
- `_method` 를 주면 그 메서드의 오퍼레이션으로 나온다 (POST → 201 단건, DELETE → 204)

### OpenAPI 가져오기 (역방향)

내보내기의 반대도 된다 — 팀에 이미 있는 OpenAPI(Swagger) 문서를 GUI 의 **JSON 붙여넣기** 창에
통째로 넣으면 (또는 `POST /schema/infer` 로 보내면) 응답 스키마 정의를 읽어 필드·타입과
리소스 이름까지 채운다. 스펙 문서가 곧 목 API 가 되는 가장 빠른 길.

```bash
curl -X POST https://mocappi.gojongwon.workers.dev/schema/infer \
  -H 'content-type: application/json' --data @openapi.json
```

- OpenAPI 3.x 와 Swagger 2.0 을 받는다. `$ref`(문서 내부)·`allOf`·`oneOf/anyOf` 해석,
  nullable(3.0 `nullable` / 3.1 `type: [..., null]`) 은 `?0.2` 로 반영
- `format` 매핑: `uuid` → `uuid`, `email` → `internet.email`, `date-time` → `date:…`,
  `uri` → `internet.url` 등. `enum`·`const`·`minimum/maximum`·`maxLength` 도 읽는다
- 문서에 오퍼레이션이 여러 개면 가장 목록다운 GET 200 하나를 고르고 나머지는 무시한다고
  알려준다 — 원하는 경로만 남긴 문서를 붙여넣으면 그 경로를 가져온다
- 객체 배열처럼 v1 DSL 이 표현 못 하는 필드는 `skipped` 로 이유와 함께 알려준다

## 대용량 데이터

`_limit` 은 최대 **1000**, `_format=ndjson` / `_format=csv` 는 아이템을 줄 단위로 스트리밍한다(envelope 없음) — 무한스크롤·가상 리스트·데이터 파이프라인 테스트용:

```
/api/logs?id=uuid&level=enum:info*8|warn*2&at=date:2026-01-01~2026-12-31&_limit=1000&_format=ndjson
/api/users?name=person.fullName&age=int:20~60&_limit=1000&_format=csv
```

형식이 달라도 데이터는 완전히 동일하다 (`_format` 은 시드에 영향 없음). CSV 는 중첩 객체를 점 표기 컬럼으로 펼치고 배열은 JSON 문자열로 넣는다 (RFC 4180 이스케이프).

참고(무료 플랜): 혼합 스키마 1000개는 10ms CPU 예산 안에 여유 있게 들어간다. 모든 필드가 faker 경로면 큰 페이지가 제한에 걸릴 수 있으니 페이지를 나눠 받을 것.

## 결정론 (스냅샷 테스트 안정성)

- 같은 URL → 항상 같은 응답 (바이트 단위 동일)
- 항목별 시드: 전역 `i`번째 항목은 `_limit`/`_page` 를 바꿔도 동일하다.
  (`_limit=10&_page=2` 의 1번째 == `_limit=20&_page=1` 의 11번째)
- 필드 순서만 다른 URL, `_delay`/`_status` 만 다른 URL → 같은 데이터
- faker `date.*` 계열은 refDate 를 `2026-01-01` 로 고정해 시간이 지나도 값이 변하지 않는다.

**v1.0 약속.** 결정성은 이제 시맨틱 버전 약속이다:

- 1.x 안에서는 시드 규칙이 바뀌지 않는다 — 시드에 들어가는 것(`_locale`, `_total`, `_seed`,
  필드 정의)과 파생 방식이 그대로이므로, 저장해 둔 URL 은 1.x 의 어느 배포에서도 같은 바이트를
  돌려준다.
- 생성 값이 바뀌는 변경 — faker 업그레이드 포함 — 은 메이저 버전에서만 온다. 그래서 faker 는
  `package.json` 에 정확한 버전(`10.5.0`)으로 고정되어 있다. 스냅샷 테스트는 mocappi 의
  메이저만 고정하면 충분하다.

**캐시:** 같은 URL 이 같은 바이트라서 성공 응답은 `Cache-Control: public, max-age=300` 으로
엣지에 5분 캐시된다 (`Cf-Cache-Status: HIT` 로 확인). 데이터는 어차피 같으니 영향은 속도뿐이다.
캐시를 타지 않는 것 둘 — `_delay` 를 준 요청(지연이 목적이라), `_status>=400` 실패 응답.
저장 프리셋(`_s=`)을 지우면 최대 5분간 옛 응답이 나올 수 있다.

## `X-Total-Count`

목록 응답은 전체 개수를 헤더로도 내보낸다. envelope 이 없는 모양 — `_wrap=none`,
`_format=ndjson`, `_format=csv` — 에서도 개수가 살아남는다. 값은 envelope 의 `total` 과 같다
(`_q`·`_sort` 면 창 안 개수). `Access-Control-Expose-Headers` 가 이미 함께 나가므로
브라우저 JS 가 크로스오리진에서 바로 읽는다.

```js
const res = await fetch('https://…/api/users?name=person.fullName&_wrap=none');
const total = Number(res.headers.get('X-Total-Count'));   // 100
```

json-server 계열 클라이언트, react-admin, refine 같은 테이블 라이브러리가 기대하는 규약이다.
목록이 아닌 응답에는 붙지 않는다 — `_wrap=one`, 쓰기 메서드(POST/PUT/PATCH),
`DELETE`(204), `_status>=400` 실패 응답.

## 안전한 연락처 데이터

목업 데이터가 실제 사람에게 닿는 일이 없도록:

- `internet.email` 은 항상 `@example.com` — IANA 예약 도메인(RFC 2606)이라 절대 배달되지 않음이 보장되고, 유저명도 읽을 수 있는 ASCII 다.
- `phone.number` 는 형식이 유효한 번호를 만든다: ko `010-####-####`, ja `090-####-####`, zh `1[3-9]#########`, en 은 픽션용 예약 대역 `(###) 555-01##` — 유효성 검사·마스킹 로직 테스트가 가능하다.

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
  gui/         # GUI 소스 — index.html + app.css + app.js
build/gui.mjs  # GUI 소스를 한 덩어리 HTML(src/gui.generated.html)로 합침
test/          # dsl / determinism / worker 테스트
```

워커는 GUI 를 HTML 문자열 하나로 서빙하므로, `src/gui/` 를 편집하고 `npm run build:gui` 로 합친다.
`wrangler dev`·`deploy`·`npm test` 는 이 빌드를 자동으로 먼저 실행한다.
산출물 `src/gui.generated.html` 은 커밋하지 않는다 — 직접 편집하지 말 것.

## v1 에서 뺀 것 (의도적)

인증, 그리고 **요청 바디를 실제로 읽는 쓰기 API**. 보낸 값을 그대로 돌려주거나 상태를 쌓아두면
같은 URL이 같은 바이트를 낸다는 약속이 깨진다 — `POST`/`PUT`/`PATCH`/`DELETE` 는 응답 모양과
상태코드만 흉내 낸다 (위 "HTTP 메서드" 참고).
