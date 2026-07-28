import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Worker 코드가 import 하는 gui.html 을 문자열로 로드 (wrangler 의 Text rule 과 동일 동작)
      name: 'html-as-text',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('.html')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        }
      },
    },
  ],
  test: { environment: 'node' },
});
