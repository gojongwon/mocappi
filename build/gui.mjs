/**
 * GUI 빌드 — src/gui/* → src/gui.generated.html (한 덩어리).
 * 워커는 HTML 을 텍스트로 import 해서 통째로 서빙하므로, 소스를 나눠도 산출물은 하나여야 한다.
 *
 * 실행 시점: wrangler.toml [build] (dev·deploy), package.json pretest (vitest), size 스크립트.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (f) => new URL(`../src/gui/${f}`, import.meta.url);

// 미니파이하지 않는다 — 지금까지처럼 읽히는 소스를 서빙해서 브라우저에서 바로 디버깅 가능하게.
// 번들 gzip 은 3MB 한도의 12% 수준이라 크기로 아쉬울 게 없다.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(at('main.js'))],
  bundle: true,
  format: 'iife', // 원본이 (() => { 'use strict'; ... })() 였던 것과 같은 모양
  target: 'es2022',
  charset: 'utf8', // 한글이 \uXXXX 로 이스케이프되지 않게
  write: false,
  legalComments: 'none',
});

// 마커는 각각 한 줄을 통째로 차지한다 → 끼워 넣는 쪽의 끝 개행 하나를 없애야 원본과 같은 모양이 된다.
const css = readFileSync(at('app.css'), 'utf8').replace(/\n$/, '');
const js = outputFiles[0].text.replace(/\n$/, '');

// replace 의 2번째 인자를 함수로 주는 건 필수 — 문자열이면 CSS·JS 안의 $& $1 $` 이 치환 패턴으로 해석된다.
const html = readFileSync(at('index.html'), 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('//__JS__', () => js);

writeFileSync(new URL('../src/gui.generated.html', import.meta.url), html);
