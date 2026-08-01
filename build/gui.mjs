/**
 * GUI 빌드 — src/gui/{index.html,app.css,app.js} → src/gui.generated.html (한 덩어리).
 * 워커는 HTML 을 텍스트로 import 해서 통째로 서빙하므로, 소스를 나눠도 산출물은 하나여야 한다.
 *
 * 실행 시점: wrangler.toml [build] (dev·deploy), package.json pretest (vitest), size 스크립트.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/gui/${f}`, import.meta.url), 'utf8');

// 마커는 각각 한 줄을 통째로 차지한다 → 끼워 넣는 쪽의 끝 개행 하나를 없애야 원본과 같은 모양이 된다.
const body = (f) => src(f).replace(/\n$/, '');

// replace 의 2번째 인자를 함수로 주는 건 필수 — 문자열이면 CSS·JS 안의 $& $1 $` 이 치환 패턴으로 해석된다.
const html = src('index.html')
  .replace('/*__CSS__*/', () => body('app.css'))
  .replace('//__JS__', () => body('app.js'));

writeFileSync(new URL('../src/gui.generated.html', import.meta.url), html);
