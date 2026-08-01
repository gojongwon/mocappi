#!/usr/bin/env node
/**
 * Stop — 턴을 끝내기 전에 typecheck + test.
 * src/ 나 test/ 에 커밋되지 않은 변경이 있을 때만 돈다 (대화만 한 턴, 커밋 직후에는 건너뜀).
 * exit 2 = 실패를 Claude 에게 되돌려 계속 작업하게 함.
 */
import { execSync } from 'node:child_process';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

try {
  // 이 훅 때문에 이어진 턴이면 다시 돌지 않는다 — 무한 루프 방지
  if (JSON.parse(raw)?.stop_hook_active) process.exit(0);
} catch { /* 입력을 못 읽어도 검증 자체는 해볼 만하다 */ }

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const run = (cmd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });

let dirty = '';
try {
  dirty = run('git status --porcelain -- src test').trim();
} catch {
  process.exit(0); // git 저장소가 아니면 조용히 통과
}
if (!dirty) process.exit(0);

try {
  run('npm run typecheck');
  run('npm test');
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  console.error('검증 실패 — 끝내기 전에 고칠 것:\n' + out.slice(-4000));
  process.exit(2);
}
