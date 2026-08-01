---
name: commit
description: 작업 중 생긴 변경을 논리 단위로 쪼개 각각 커밋한다. "커밋해줘", "정리해서 커밋", 여러 변경이 섞였을 때 사용.
---

# 1 논리 = 1 커밋

한 커밋은 되돌릴 수 있는 최소 단위여야 한다. "리팩터링 + 버그 수정 + 오타"가 한 커밋에 있으면
버그 수정만 되돌릴 방법이 없다.

## 절차

### 1. 무엇이 바뀌었는지 본다

```bash
git status --porcelain
git diff            # 스테이지 안 된 것
git diff --staged   # 이미 스테이지된 것
```

파일 목록만 보고 그룹을 정하지 말 것 — **diff 를 읽어라.** 한 파일에 두 논리가 섞여 있는 경우가 흔하다.

### 2. 논리 단위로 그룹핑

같은 커밋에 들어가는 것:
- 하나의 동작 변경 + 그 테스트 + 그 문서
- 한 기능의 ko/en 양쪽 문자열 (CLAUDE.md 의 "ko/en 쌍" 규칙 — 쪼개면 반쪽 상태가 커밋된다)
- README.md 와 README.ko.md 의 같은 내용

다른 커밋으로 가는 것:
- 기능 추가와 그와 무관한 버그 수정
- 동작 변경과 순수 포맷팅
- 작업 중 눈에 띄어 겸사겸사 고친 것 ("김에 고친 것"은 거의 항상 별도 커밋)

### 3. 그룹별로 스테이징

**파일 경계로 나뉘면** — 경로를 명시한다:

```bash
git add src/dsl.ts test/dsl.test.ts
```

**한 파일에 두 논리가 섞였으면** — 패치로 나눈다:

```bash
git diff -- src/gui/save.js > /tmp/split.patch
# /tmp/split.patch 를 편집해 이번 커밋에 들어갈 hunk 만 남긴다
git apply --cached /tmp/split.patch
```

`git add -p` 와 `git add -i` 는 이 환경에서 인터랙티브 입력이 안 되므로 쓰지 않는다.

`git add -A` / `git add .` 는 그룹이 정말 전부일 때만. 습관적으로 쓰면 그룹핑을 안 한 것과 같다.

### 4. 커밋 전 검증

```bash
npm run typecheck && npm test
```

**그룹마다** 돈다. 마지막에 한 번만 돌리면 중간 커밋들이 깨진 상태로 남고, `git bisect` 가 무의미해진다.

### 5. 메시지

```
type(scope): 한국어 요약 (vX.Y.Z)

- 왜 이렇게 했는지
- 대안을 안 고른 이유 / 알려진 한계
- 확인한 방법 (있으면)
```

- 헤더 72자 이내. 요약은 **무엇을 했는지가 아니라 무엇이 달라졌는지**
- type: `feat` `fix` `refactor` `test` `docs` `chore` `ci`
- scope: `gui` `api` `dsl` `infer` `registry` `store` `og` `seo` `build` — 전역이면 생략
- 본문 불릿은 diff 를 다시 쓰지 않는다. diff 가 말하지 않는 것(왜, 한계, 함정)만 적는다

### 6. 버전

| type | package.json | 헤더 표기 |
|---|---|---|
| `feat` `fix` | patch 올림 (기능이 크면 minor) | `(vX.Y.Z)` |
| `refactor` `test` `docs` `chore` `ci` | 그대로 | 없음 |

버전을 올렸으면 그 커밋에 `package.json` 도 함께 스테이징한다.
사용자에게 보이는 기능이면 GUI 새 소식(`src/gui/index.html` 의 `#newsModal` +
`src/gui/i18n.js` 의 `newsList`)도 같은 커밋에.

## 마지막에

```bash
git log --oneline -<커밋 수>
git status --porcelain   # 비어 있어야 한다 — 남은 게 있으면 왜 안 넣었는지 사용자에게 말할 것
```

푸시는 요청받았을 때만.
