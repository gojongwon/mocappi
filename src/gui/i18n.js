// ---- i18n — 한국어가 원본, 영어는 사전으로 덮어쓴다 ----
// 언어 상태는 URL 해시(#en/#ko)에만 둔다. 쿼리 파라미터는 금지:
// location.search 전체가 스키마 정의로 파싱되므로 ?lang= 은 필드가 돼버린다.
export const LANG = location.hash === '#en' ? 'en' : location.hash === '#ko' ? 'ko' : (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
export const t = (ko, en) => LANG === 'en' ? en : ko;

// 짧은 정적 텍스트 — data-i18n / data-i18n-ph / data-i18n-title 키 → 영어
const EN = {
  // 헤더
  presets: 'Presets',
  presetUsers: 'Users',
  presetProducts: 'Products',
  presetOrders: 'Order detail',
  teamSelTitle: 'Schemas saved in this workspace',
  wsBtnTitle: 'Create or switch a preset workspace',
  workspace: 'Workspace',
  howToUse: 'How to use',
  helpShort: 'Help', // 헤더 버튼 — 모바일 1행 폭 때문에 짧게 (모달 제목은 howToUse)
  // 스키마 패널
  schema: 'Schema',
  resource: 'Resource',
  addField: '+ Add field',
  options: 'Options',
  optTotal: 'Total',
  optLimit: 'Per page',
  optPage: 'Page',
  optLocale: 'Locale',
  optQ: 'Search',
  optQin: 'Search in',
  optDelay: 'Delay ms',
  optStatus: 'Status code',
  optBody: 'Failure body',
  bodyGhostHint: 'Tab ⇥ to fill the default',
  fmtBody: '{ } Format',
  fmtBodyTitle: 'Re-indent the current JSON with 2 spaces — pasting formats automatically, hand-typed JSON needs this button',
  optWrap: 'Shape',
  optSeed: 'Seed',
  optFormat: 'Format',
  okeyTotal: 'Key name — rename to match your real API (e.g. total)',
  okeyLimit: 'Key name — rename to match your real API (e.g. limit)',
  okeyPage: 'Key name — rename to match your real API (e.g. page)',
  okeyLocale: 'Key name — rename to match your real API (e.g. locale)',
  okeyQ: 'Key name — rename to match your real API (e.g. keyword)',
  okeyQin: 'Key name — rename to match your real API (e.g. qin)',
  okeyDelay: 'Key name — rename to match your real API (e.g. delay)',
  okeyStatus: 'Key name — rename to match your real API (e.g. status)',
  okeyGeneric: 'Key name — rename to match your real API',
  localeKo: 'Korean',
  localeJa: 'Japanese',
  localeZh: 'Chinese',
  wrapNone: 'array only',
  wrapOne: 'single object',
  formatNdjson: 'NDJSON (line-delimited)',
  phQ: 'substring match on values',
  phQin: 'limit to (e.g. name,city)',
  phSeed: 'e.g. 123 (a detail API id)',
  advSummary: 'Advanced — delay · status · failure body · shape · seed · format',
  pasteJson: '{ } Paste JSON',
  pasteJsonSub: 'Paste a real API response and the schema builds itself',
  // URL 패널
  generatedUrl: 'Generated URL',
  copyUrl: 'Copy URL',
  shortUrl: 'Short URL',
  copyShortUrl: 'Copy short URL',
  tsBtnTitle: 'Copy a TypeScript interface + generic fetch helper for this schema',
  copyTs: 'Copy TS types',
  saveBtnTitle: 'Save this schema as a workspace preset — creates a short URL (_s=ID)',
  saveAsPreset: 'Save as preset',
  loading: 'Loading…',
  copyResp: 'Copy full response',
  // 코너 버튼
  newsBtnTitle: 'See recent updates',
  newsLabel: "v0.28 · What's new",
  fbBtnTitle: 'Send feedback to the developer',
  feedback: 'Feedback',
  // 모달
  whatsNew: "What's new",
  close: 'Close',
  send: 'Send',
  phFeedback: 'e.g. Add a BOM to CSV so Excel opens it correctly',
  wsNew: 'Create new workspace',
  wsShare: 'Copy workspace link',
  wsLeave: 'Leave workspace',
  phWsJoin: 'Paste a workspace ID or link',
  wsSwitch: 'Switch',
  phSaveName: 'Name (e.g. Products — for frontend dev)',
  savedOk: '✓ Saved — call this URL from anywhere',
  save: 'Save',
  pasteTitle: 'Paste JSON',
  phPaste: '{"id": "a1b2...", "name": "Kim Minjun", "age": 34, "tags": ["a", "b"]}',
  cancel: 'Cancel',
  pasteApply: 'Infer & fill',
};

// 큰 블록 — data-en-block 키 → innerHTML 통째 교체 (구조·클래스·id 는 원본과 동일하게 유지)
const EN_BLOCKS = {
  welcome: `
  <span><b>First time here?</b> Paste a real API response and your mock API is ready.</span>
  <button class="go" id="welcomePaste">Paste JSON</button>
  <button class="go ghost" id="welcomeHelp">How to use</button>
  <button class="x" id="welcomeClose" title="Close">✕</button>
`,
  keyhint: `
    Field name = the <b>key</b> in the response JSON · nested <code>customer.name</code> · arrays <code>tags[]</code>
  `,
  hintbar: `
    Type in the type box to get autocomplete ·
    <a href="#" id="helpLink">How to use</a> ·
    <a href="/schema/types" target="_blank">All types</a>
  `,
  newsList: `
    <li><span class="v">v0.28</span>Beyond GET — <b>POST·PUT·PATCH·DELETE</b>. Pick one above the URL and it sends that verb <b>for real</b> (the URL stays clean). POST answers 201 + a single item, DELETE answers 204. Any status at 400+ returns a failure body, and the <b>Failure body</b> field under Advanced previews the default response in grey and <b>Tab</b> fills it in for you to edit. Pasted JSON is auto-formatted and colored (hand-typed: hit <b>{ } Format</b>)</li>
    <li><span class="v">v0.27</span>English support — switch with the EN/KO button in the header, auto-detected from your browser. API error hints follow <code>Accept-Language</code> too</li>
    <li><span class="v">v0.26</span>Masking types <code>mask.name</code>·<code>mask.email</code>·<code>mask.phone</code>·<code>mask.card</code> — redacted PII like real services show ("김*준", "010-****-5678")</li>
    <li><span class="v">v0.25</span>New name — Mock API Builder → <b>mocappi</b>, with a lightning badge on the logo ⚡ Now at <code>mocappi.gojongwon.workers.dev</code>; features and saved data unchanged</li>
    <li><span class="v">v0.24</span>Link preview cards (OG) when sharing + search engine support (robots, meta, structured data)</li>
    <li><span class="v">v0.23</span>Mobile overhaul — unified preset dropdown, redesigned modals/help/header, background scroll lock, better autocomplete</li>
    <li><span class="v">v0.22</span>Storage upgraded to D1 — daily save limit up from 1,000 to <b>100,000</b>. NDJSON/CSV previews now render as tables and numbered lines</li>
    <li><span class="v">v0.21</span>What's new and feedback channels added. Advanced options stay collapsed until you need them</li>
    <li><span class="v">v0.20</span>Multi-segment paths (<code>/api/v2/shops/57/reviews</code>) and <code>_wrap=one</code> single-object responses — mimic detail APIs. Presets renewed as feature showcases</li>
    <li><span class="v">v0.19</span>Rename parameter keys to match your real API — click a key in the options to change it to <code>page</code>, <code>size</code>, …</li>
    <li><span class="v">v0.18</span>Japanese (<code>ja</code>) and Chinese (<code>zh</code>) locales</li>
    <li><span class="v">v0.16</span>Search generated data with <code>_q</code> · limit fields with <code>_qin</code></li>
    <li><span class="v">v0.14</span><code>_limit</code> up to 1000 + NDJSON/CSV streaming (10x faster generation)</li>
    <li><span class="v">v0.11~13</span>Advanced types (nullable, weighted enum, pattern), auto-detected when pasting JSON, emails and phone numbers guaranteed not to exist</li>
  `,
  fbIntro: `Rough edges, missing features — anything goes. Sent anonymously to the developer.`,
  helpBody: `
    <h4><span class="n">1</span>Two ways to start</h4>
    <p><b>Paste JSON</b> — paste a real API response and the fields and types are filled in automatically. The fastest way.<br>
       <b>Presets</b> — start from the Users / Products / Orders preset and tweak it (header buttons on desktop, the dropdown on mobile).</p>

    <h4><span class="n">2</span>A field = name + type</h4>
    <p>The left box is the JSON key, the right box is how its value is generated (the type).
       Start typing in the type box and an autocomplete list appears — typing just <code>per</code> already shows the person types.</p>
    <table>
      <tr><th>What you want</th><th>Type</th><th>Example output</th></tr>
      <tr><td>Name / email / phone</td><td><code>person.fullName</code> <code>internet.email</code> <code>phone.number</code></td><td>"김민준" / "mia.kim@example.com" / "010-…"</td></tr>
      <tr><td>City / address / company</td><td><code>location.city</code> <code>location.streetAddress</code> <code>company.name</code></td><td>"서울" / "…로 12" / "주식회사 …"</td></tr>
      <tr><td>Number in a range</td><td><code>int:20~60</code> · <code>float:0~100:2</code></td><td>34 · 87.52</td></tr>
      <tr><td>True/false (with probability)</td><td><code>bool:0.8</code></td><td>true 80% of the time</td></tr>
      <tr><td>One of several</td><td><code>enum:pending|paid|shipped</code></td><td>one of the three</td></tr>
      <tr><td>Date in a range</td><td><code>date:2024-01-01~2026-12-31</code></td><td>"2025-06-01T09:12:00.000Z"</td></tr>
      <tr><td>Always the same value</td><td><code>const:v1</code></td><td>"v1"</td></tr>
      <tr><td>Unique ID / sequence</td><td><code>uuid</code> · <code>index</code></td><td>"a1b2…" · 0, 1, 2…</td></tr>
      <tr><td>Long text / image</td><td><code>text:50</code> · <code>image:200x200</code></td><td>50-char sentence · image URL</td></tr>
    </table>
    <details class="adv">
      <summary>Advanced types — when you need more realistic data</summary>
      <table>
        <tr><th>What you want</th><th>Type</th><th>Example output</th></tr>
        <tr><td>Formatted code</td><td><code>pattern:ORD-####-???</code></td><td>"ORD-4821-KQZ" — # digit ? uppercase * alphanumeric</td></tr>
        <tr><td>Weighted choice</td><td><code>enum:paid*8|refund*2</code></td><td>paid 80% / refund 20%</td></tr>
        <tr><td>Sometimes null</td><td><code>internet.email?0.2</code></td><td>null 20% of the time — append ?probability to any type</td></tr>
        <tr><td>Masked PII</td><td><code>mask.name</code> <code>mask.email</code> <code>mask.phone</code> <code>mask.card</code></td><td>"김*준" / "mi***@example.com" / "010-****-5678"</td></tr>
      </table>
    </details>

    <h4><span class="n">3</span>Objects inside objects — dots in the name</h4>
    <p>Put a dot in the field name to get a nested object. The type works as usual.</p>
    <pre>customer.name = person.fullName
customer.address.city = location.city</pre>
    <div class="arrow">↓ responds like this</div>
    <pre>{
"customer": {
  "name": "김민준",
  "address": { "city": "서울" }
}
}</pre>

    <h4><span class="n">4</span>Arrays — [] after the name, count with :N at the end of the value</h4>
    <pre>tags[] = lorem.word:3

→ "tags": ["보장하기", "재외국민을", "영장을"]</pre>

    <h4><span class="n">5</span>Pagination and testing options</h4>
    <table>
      <tr><th>Option</th><th>What it does</th></tr>
      <tr><td><code>_total</code> / <code>_limit</code> / <code>_page</code></td><td>virtual total count / items per page / page number</td></tr>
      <tr><td><code>_delay=3000</code></td><td>respond 3s late — test loading spinners</td></tr>
      <tr><td><code>_status=500</code></td><td>force a status code — test error screens</td></tr>
      <tr><td><code>_locale=en</code></td><td>English data (<code>ja</code> Japanese, <code>zh</code> Chinese)</td></tr>
      <tr><td><code>_seed=v2</code></td><td>a different dataset — same seed always means same data</td></tr>
      <tr><td><code>_wrap=none</code></td><td>bare array, no envelope (<code>one</code> = a single object — detail APIs)</td></tr>
      <tr><td><code>_format=ndjson</code></td><td>stream items line by line — for large data (<code>csv</code> works too)</td></tr>
      <tr><td><code>_q=김</code></td><td>search the generated data — substring match on values, <code>total</code> becomes the match count</td></tr>
      <tr><td><code>_qin=name,city</code></td><td>limit which fields are searched — use with <code>_q</code> (nested: <code>a.b</code>)</td></tr>
      <tr><td><code>_alias=page:_page</code></td><td>map reserved keys to your real API's names — generated automatically when you <u>click a key name</u> in the options</td></tr>
    </table>
    <p style="font-size:12.5px;color:var(--muted)">Limits: <code>_limit</code> max 1000 · <code>_q</code> 100 chars · <code>_delay</code> 5s.
       For more data, keep paging with <code>_page</code> — e.g. 5,000 items = <code>_total=5000&amp;_limit=1000</code> over 5 pages.</p>

    <h4><span class="n">✓</span>Good to know</h4>
    <p>The same URL <b>always returns the same data</b> — after a refresh, or tomorrow. Safe for snapshot tests.<br>
       Need a different dataset? Append <code>_seed=anything</code>.<br>
       Share a finished schema with your team via <b>Save</b> — you get a short <code>?_s=ID</code> URL that other parameters can override (e.g. <code>?_s=aB3xK9&amp;_page=2</code>). The <b>Copy TS types</b> button generates a TypeScript interface for the current schema on the spot.<br>
       If a URL is wrong, the 400 response explains what is wrong and why.<br>
       Resource paths can have multiple segments like <code>/api/v2/users/123/orders</code> — the path is decoration, the query defines the data,
       and detail responses come from the <code>_wrap=one&amp;_seed=123</code> combo.</p>
  `,
  wsIntro: `Presets are saved and shared <b>per workspace</b>, and only people <b>with the link</b> can access it.`,
  wsNote: `
    If you lose the link, the workspace cannot be recovered — keep it in your team docs. Saved items expire after 180 days without use.`,
  saveIntro: `Adds it to this workspace's preset list and creates a short URL.<br>
     Edit and save again to get a new URL — existing URLs keep working.`,
  saveSetup: `
    <p style="margin-top:0"><b>Team saving is not enabled yet.</b><br>
    Connect the storage (Cloudflare KV) once — whoever deploys runs this in a terminal:</p>
    <pre style="font-family:var(--mono);font-size:12.5px;background:var(--bg);border-radius:8px;padding:12px 14px;line-height:1.8;overflow-x:auto">npx wrangler kv namespace create SCHEMAS
# paste the printed id into the [[kv_namespaces]] block in wrangler.toml and uncomment it
npm run deploy</pre>
    <p>Everything else works fine before it is connected.</p>
  `,
  saveWsRequired: `
    <p style="margin-top:0"><b>Saving presets requires a workspace.</b><br>
    Shared only among people who have the link.</p>
    <div class="modal-actions" style="justify-content:flex-start">
      <button id="saveWsCreate" style="background:var(--accent);color:var(--accent-text)">Create a workspace and continue</button>
      <button id="saveWsJoin" style="background:var(--accent-soft);color:var(--ink)">Switch to an existing workspace</button>
    </div>
  `,
  pasteIntro: `Paste a real API response or a sample object and the fields and types are inferred automatically.
     <code style="font-family:var(--mono);font-size:12px">{"data": [...]}</code> envelopes are unwrapped for you.`,
};

export function applyEn() {
  document.documentElement.lang = 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = EN[el.dataset.i18n];
    if (v != null) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    const v = EN[el.dataset.i18nPh];
    if (v != null) el.placeholder = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const v = EN[el.dataset.i18nTitle];
    if (v != null) el.title = v;
  }
  for (const el of document.querySelectorAll('[data-en-block]')) {
    const html = EN_BLOCKS[el.dataset.enBlock];
    if (html != null) el.innerHTML = html;
  }
}
