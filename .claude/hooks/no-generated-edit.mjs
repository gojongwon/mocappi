#!/usr/bin/env node
/**
 * PreToolUse(Edit|Write) — 빌드 산출물 편집을 막는다.
 * 분리 구조가 새로 만든 유일한 함정: gui.generated.html 을 고쳐도 다음 빌드에 그대로 날아간다.
 * exit 2 = 도구 호출 차단 + stderr 를 Claude 에게 되돌려줌.
 */
let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let path = '';
try {
  path = JSON.parse(raw)?.tool_input?.file_path ?? '';
} catch {
  process.exit(0); // 입력을 못 읽으면 막지 않는다 — 훅이 작업을 세우는 쪽이 더 나쁘다
}

if (/gui\.generated\.html$/.test(path)) {
  console.error(
    `${path} 은 빌드 산출물이다. 고칠 곳은 src/gui/ 안의 소스 (index.html · app.css · *.js).\n` +
    '고친 뒤 npm run build:gui — 조립 규칙은 build/gui.mjs 에 있다.',
  );
  process.exit(2);
}

if (/(^|\/)dist\//.test(path)) {
  console.error(`${path} 은 esbuild 산출물이다 (npm run size). 소스는 src/ 에 있다.`);
  process.exit(2);
}
