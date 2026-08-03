# mocappi

URL 만으로 정의하는 목 REST API. Cloudflare Workers 단일 워커, 런타임 의존성은 `@faker-js/faker` 하나.
핵심 약속은 **같은 URL 이면 언제나 같은 바이트**.

## 명령

```bash
npm test          # vitest (pretest 가 GUI 빌드를 먼저 돌린다)
npm run typecheck # tsc --noEmit
npm run dev       # wrangler dev → http://localhost:8787
npm run build:gui # src/gui/* → src/gui.generated.html
npm run size      # 번들 gzip (무료 플랜 3MB 한도, 현재 ~356KB)
npm run deploy    # 배포 — 요청받았을 때만
```

## 구조

```
src/
  index.ts      라우터. GET / (GUI) · /api/<res> · /schema/{types,ts,infer,save,saved} · /feedback · SEO
  dsl.ts        쿼리스트링 → ParsedQuery. 여기서 normalized(시드 입력) 를 만든다
  registry.ts   타입 레지스트리 + TYPE_DOCS/TYPE_DOCS_EN (/schema/types 응답)
  generate.ts   baseSeedOf · generateItem · 페이지네이션 · 검색
  store.ts      콘텐츠 주소 저장 + 워크스페이스   d1.ts  D1 어댑터 (없으면 KV 폴백)
  infer.ts      예시 JSON → 스키마 추론          tstype.ts  스키마 → TS 타입
  rng.ts        FNV-1a + mulberry32             og.ts  OG 이미지 base64
  gui/          GUI 소스 (아래)
build/gui.mjs   esbuild 로 gui/* 를 HTML 한 덩어리로 인라인
```

### GUI (`src/gui/`)

워커는 HTML **문자열 하나**를 서빙한다. 그래서 소스는 나뉘어 있고 빌드가 다시 합친다.

| 파일 | 역할 |
|---|---|
| `index.html` | head 메타·JSON-LD + 마크업. `/*__CSS__*/`·`//__JS__` 두 마커에 빌드가 끼워 넣는다 |
| `app.css` | 전체 스타일 (모바일은 640px 이하 미디어 쿼리) |
| `pure.js` | **DOM·전역을 안 건드리는 함수만.** Node 에서 그대로 테스트 가능 |
| `shared.js` | 모듈 경계를 넘는 가변 상태 4개 |
| `main.js` | 이벤트 위임·모달 스크롤락·초기화. 진입점 |
| `i18n.js` `dom.js` `url-state.js` `preview.js` `render.js` `save.js` `workspace.js` `paste.js` `autocomplete.js` | 이름대로 |

**의존 그래프는 DAG 다. 순환을 다시 만들지 말 것.**

```
i18n  pure  shared            (잎 — 아무것도 import 안 함)
  └ dom                       ($, addRow, 클립보드, emit/on)
      ├ url-state  render  workspace  autocomplete  paste
      │     └ preview  save
      └ main                  (진입점 — 아무도 여기를 import 하지 않는다)
```

**모듈 A 가 B 의 함수를 부르고 싶은데 B 가 이미 A 를 import 한다면, 이벤트를 쓴다.**
`dom.js` 의 `emit(name)` / `on(name, fn)` — `document` 위의 `CustomEvent` 다.
`dispatchEvent` 는 **동기**라 직접 호출과 실행 순서·타이밍이 같다.

| 이벤트 | 발신 | 수신 |
|---|---|---|
| `schema:changed` | 스키마·옵션을 바꾼 모든 곳 (10곳) | `preview.js` — 미리보기 + 주소창 갱신 |
| `ws:changed` | `workspace.switchWs` | `save.refreshTeam` — 프리셋 목록 새로고침 |
| `team:ready` | `save.refreshTeam` (저장소 응답 확인) | `workspace.syncWsUi` — 워크스페이스 버튼 상태 |

`preview.js` 는 **export 가 하나도 없다.** 순수 구독자라서다 — 이게 깨지면 순환이 돌아온 것.
구독을 빠뜨려도 조용히 통과하므로 `test/gui-wiring.test.ts` 가 세 이벤트를 전부 확인한다.

**GUI 를 고칠 때 여는 파일은 `src/gui/` 안의 것 하나다.** `src/gui.generated.html` 은 빌드 산출물 —
편집하면 다음 빌드에 사라지고, 훅이 막는다.

빌드 실행 시점: `wrangler dev`/`deploy`(wrangler.toml `[build]`), `npm test`(`pretest`), `npm run size`.
`[build]` 의 `watch_dir` 은 반드시 `src/gui` — `src` 로 두면 산출물 쓰기가 빌드를 다시 불러 루프가 된다.

## 절대 깨면 안 되는 것

**1. 결정성.** 같은 URL → 바이트 동일 응답. 시드는 `dsl.ts` 의 `normalized` 하나로만 정해진다:
`_locale`, `_total`, `_seed`, 그리고 `필드명=타입원문`. **`_page`·`_limit`·`_delay`·`_status`·`_wrap`·
`_format`·`_q`·`_qin` 은 시드에 들어가지 않는다** — 페이지를 넘겨도 i번째 항목은 그대로여야 하고,
포맷을 바꿔도 데이터가 같아야 한다. `normalized` 에 뭔가 더하는 변경은 저장된 모든 `_s=` URL 의
데이터를 바꾼다. `test/determinism.test.ts` 가 지킨다.

**2. ko/en 쌍.** 사용자에게 보이는 문자열은 한국어와 영어가 항상 함께 간다.
- 서버: `index.ts` 의 `pick(lang, ko, en)`, `registry.ts` 의 `fail(error, value, hint, hintEn)`
- GUI 동적 문자열: `t('한국어', 'English')`
- GUI 정적 텍스트: 마크업에 `data-i18n`(또는 `-ph`/`-title`) + `i18n.js` 의 `EN` 사전
- GUI 큰 블록: 마크업에 `data-en-block` + `i18n.js` 의 `EN_BLOCKS`

응답 JSON 의 키는 `hint` 하나만 나간다 (`hintEn` 은 직렬화 전에 제거).

**3. 안전한 연락처.** `internet.email` 은 `@example.com`(RFC 2606), `phone.number` 는 각 로케일의
가공 번호대만. 실존 인물에게 도달할 수 있는 값은 만들지 않는다. `test/safe-contact.test.ts`.

**4. localStorage 금지.** GUI 상태는 URL 이 곧 상태다 (`location.search` = 스키마, 해시 `#en`/`#ko` = 언어).
언어에 쿼리 파라미터를 쓰면 스키마 필드로 파싱된다 — 그래서 해시다.

## 자주 하는 작업

**새 DSL 타입 추가** — 셋을 같이: `registry.ts` 의 생성 함수 + `TYPE_DOCS.dslTypes`(영어 짝은
`DSL_DOCS_EN`, 순서 1:1) + `test/`. 하나라도 빠지면 `/schema/types` 와 실제가 어긋난다.

**사용자에게 보이는 변경** — 아래 넷을 **매번 같이** 훑는다. 하나씩 빠뜨리기 쉬운데,
빠지면 문서가 없는 게 아니라 **틀린 상태로 남는다** (없어진 버튼을 계속 가리키는 식).

| 자리 | 한국어 | 영어 |
|---|---|---|
| README | `README.ko.md` | `README.md` |
| GUI 새 소식 | `index.html` 의 `#newsModal` | `i18n.js` 의 `newsList` |
| GUI 사용법 | `index.html` 의 `data-en-block="helpBody"` 마크업 | `i18n.js` 의 `EN_BLOCKS.helpBody` |
| 헤더 배지 | `newsLabel` — 마이너 버전이 오를 때만 | 〃 |

새 소식은 **마이너 버전당 `<li>` 하나**다. 패치로 기능이 늘면 새 줄을 만들지 말고
그 버전 줄에 이어 쓴다. 사용법은 절 번호가 ko/en 1:1 이어야 한다 —
절·표·항목 수를 세서 맞춰볼 것.

UI 라벨을 바꾸거나 없앴으면 **다른 문서가 그 이름을 부르고 있는지 먼저 grep** 한다.

**모바일** — 640px 이하는 헤더 1행 유지가 계속 깨져 온 지점 (커밋 히스토리 v0.23.x 참고).
헤더에 뭔가 추가하면 360px 폭에서 워크스페이스 칩 + 한국어 라벨 조합을 확인할 것.

## 커밋

`type(scope): 한국어 요약 (vX.Y.Z)` — 헤더 72자 이내, 본문은 `- ` 불릿으로 **왜**와 **한계**.

- scope: `gui` `api` `dsl` `infer` `registry` `store` `og` `seo` `build`
- `feat`/`fix` 는 `package.json` 버전을 patch 올리고 헤더에 `(vX.Y.Z)` 표기.
  `docs`/`chore`/`refactor`/`test`/`ci` 는 버전을 올리지 않고 표기도 없음
- **1 논리 = 1 커밋.** 무관한 변경을 묶지 말 것 (`/commit` 스킬이 절차를 갖고 있다)

## 완료 기준

`npm run typecheck` 와 `npm test` 가 통과해야 끝이다. GUI 를 고쳤으면 `npm run dev` 로
실제 화면도 볼 것 — 순수 함수 테스트는 `pure.js` 만 덮으며, 이벤트 배선·렌더는 테스트가 없다.

## 스타일

주석·커밋 메시지·GUI 기본 문구는 한국어. 코드 식별자는 영어.
주석은 **왜**를 적는다 (무엇을 하는지는 코드가 말한다). 기존 파일의 밀도와 톤에 맞출 것.
