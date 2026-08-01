(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const fieldsEl = $('#fields');

  // ---- i18n — 한국어가 원본, 영어는 사전으로 덮어쓴다 ----
  // 언어 상태는 URL 해시(#en/#ko)에만 둔다. 쿼리 파라미터는 금지:
  // location.search 전체가 스키마 정의로 파싱되므로 ?lang= 은 필드가 돼버린다.
  const LANG = location.hash === '#en' ? 'en' : location.hash === '#ko' ? 'ko' : (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const t = (ko, en) => LANG === 'en' ? en : ko;

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
    advSummary: 'Advanced — delay · status · shape · seed · format',
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
    newsLabel: "v0.27 · What's new",
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

  function applyEn() {
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
  if (LANG === 'en') applyEn();
  // 토글은 리로드 방식 — 해시만 바꾸므로 스키마 상태(location.search)는 건드리지 않는다
  $('#langLabel').textContent = LANG === 'en' ? 'KO' : 'EN';
  const OPT_DEFAULTS = { _total: '100', _limit: '10', _page: '1', _locale: 'ko', _delay: '0', _status: '200', _q: '', _qin: '', _wrap: 'envelope', _seed: '', _format: 'json' };
  const OPT_INPUTS = { _total: '#oTotal', _limit: '#oLimit', _page: '#oPage', _locale: '#oLocale', _delay: '#oDelay', _status: '#oStatus', _q: '#oQ', _qin: '#oQin', _wrap: '#oWrap', _seed: '#oSeed', _format: '#oFormat' };

  // ---- 옵션 키 별칭 (인라인 편집 → _alias 자동 조립) ----
  const ALIAS_OK_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

  /** 기본값과 다르고 유효한 키만 { 예약어: 별칭 } 으로. 유효하지 않으면 .bad 표시 후 무시 */
  function optAliases() {
    const map = {};
    for (const el of document.querySelectorAll('.okey')) {
      const def = el.dataset.for;
      const v = el.value.trim();
      const valid = v === def || ALIAS_OK_RE.test(v);
      el.classList.toggle('bad', !valid);
      if (valid && v !== def && v !== '') map[def] = v;
    }
    return map;
  }

  /** { 예약어: 별칭 } 적용 — 없는 키는 기본값으로 복원 */
  function setOptKeys(byDef) {
    for (const el of document.querySelectorAll('.okey')) {
      el.value = (byDef && byDef[el.dataset.for]) || el.dataset.for;
      el.classList.remove('bad');
    }
  }

  /** URL 의 _alias 파라미터 파싱 → { rev: 별칭→예약어, byDef: 예약어→별칭 } */
  function parseAliasParam(params) {
    const rev = {}; const byDef = {};
    const raw = params.get('_alias');
    if (raw) {
      for (const ent of raw.split(',')) {
        const i = ent.indexOf(':');
        if (i > 0) {
          const a = ent.slice(0, i).trim(); const d = ent.slice(i + 1).trim();
          if (a && d) { rev[a] = d; byDef[d] = a; }
        }
      }
    }
    return { rev, byDef };
  }

  // 프리셋 3종 — 기능 쇼케이스를 겸한다:
  //  users:    목록 + nullable(?p) + 가중치 enum + 중첩 객체
  //  products: pattern 코드 + 배열 + float + nullable 긴 글
  //  orders:   상세 엔드포인트 — 다단계 경로 + _wrap=one + _seed
  const PRESETS = {
    users: {
      res: 'users',
      fields: [
        ['id', 'uuid'], ['name', 'person.fullName'], ['email', 'internet.email?0.1'],
        ['tel', 'phone.number'], ['role', 'enum:admin*1|member*8|guest*3'],
        ['active', 'bool:0.85'], ['avatar', 'image:80x80'],
        ['address.city', 'location.city'], ['address.street', 'location.streetAddress'],
        ['joinedAt', 'date:2023-01-01~2026-07-01'],
      ],
      opts: { _total: '500', _limit: '20' },
    },
    products: {
      res: 'products',
      fields: [
        ['id', 'index'], ['sku', 'pattern:PRD-####-??'], ['name', 'commerce.productName'],
        ['price', 'int:1000~99000'], ['discountRate', 'float:0~0.5:2'],
        ['stock', 'int:0~500'], ['status', 'enum:sale*7|soldout*2|hidden*1'],
        ['tags[]', 'commerce.department:2'], ['images[]', 'image:300x300:3'],
        ['description', 'text:80?0.2'],
      ],
      opts: { _total: '300', _limit: '20' },
    },
    orders: {
      res: 'orders/1024',
      fields: [
        ['orderNo', 'pattern:ORD-2026-######'], ['status', 'enum:paid*5|shipped*3|delivered*4|cancelled*1'],
        ['amount', 'int:9000~450000'], ['paidAt', 'date:2026-01-01~2026-07-29'],
        ['customer.name', 'person.fullName'], ['customer.tel', 'phone.number'],
        ['customer.email', 'internet.email'],
        ['shipping.city', 'location.city'], ['shipping.street', 'location.streetAddress'],
        ['items[]', 'commerce.productName:3'], ['memo', 'text:40?0.3'],
      ],
      opts: { _wrap: 'one', _seed: '1024' },
    },
  };

  // ---- 인코딩: 읽기 좋은 URL 을 위해 안전 문자는 되살린다 ----
  const enc = (s) => encodeURIComponent(s)
    .replace(/%3A/gi, ':').replace(/%7E/gi, '~').replace(/%7C/gi, '|')
    .replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%2C/gi, ',');

  // ---- 필드 행 ----
  // 인자가 없어 직접 수정할 일이 없는 타입 — 입력 잠금 (▾ 로 교체, ✕ 로 삭제는 가능)
  const ARGLESS_TYPES = ['uuid', 'index'];

  function applyLock(row) {
    const fv = row.querySelector('.fval');
    const locked = ARGLESS_TYPES.includes(fv.value.trim());
    fv.readOnly = locked;
    fv.classList.toggle('locked', locked);
    fv.title = locked
      ? fv.value + t(' — 인자가 없는 타입이라 수정할 게 없어요. 직접 고치려면 더블클릭.', ' — this type takes no arguments, so there is nothing to edit. Double-click to edit anyway.')
      : fv.value;
    const fn = row.querySelector('.fname');
    fn.title = fn.value;
  }

  /**
   * OS/브라우저 자동완성 바(iOS 열쇠·지갑·주소 등) 억제 힌트.
   * 목업 도구의 입력은 개인정보 필드가 아닌데 브라우저가 추측으로 AutoFill 바를 띄운다.
   * (OS 가 최종 결정권을 가지므로 100% 보장은 아님 — 표준 억제 수단 총동원)
   */
  function hardenInputs(root) {
    for (const el of (root || document).querySelectorAll('input, textarea, select')) {
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
      el.setAttribute('data-1p-ignore', '');      // 1Password
      el.setAttribute('data-lpignore', 'true');   // LastPass
      el.setAttribute('data-form-type', 'other'); // Dashlane 등
    }
  }

  function addRow(name = '', value = '') {
    const row = document.createElement('div');
    row.className = 'frow';
    row.innerHTML =
      '<input class="fname" placeholder="' + t('필드명 (중첩은 a.b)', 'field name (a.b for nested)') + '" spellcheck="false">' +
      '<input class="fval" placeholder="' + t('타입 — 클릭하면 목록', 'type — click for the list') + '" spellcheck="false" autocomplete="off">' +
      '<button class="del" title="' + t('필드 삭제', 'Remove field') + '">✕</button>';
    row.querySelector('.fname').value = name;
    row.querySelector('.fval').value = value;
    applyLock(row);
    hardenInputs(row);
    fieldsEl.appendChild(row);
    return row;
  }

  let typeOptions = null; // /schema/types 응답 — 단일 소스

  // ---- 타입 자동완성 (커스텀 드롭다운 — 높이 제한 + 스크롤 + 키보드) ----
  let AC_ITEMS = [];
  function buildAcItems() {
    AC_ITEMS = [];
    if (!typeOptions) return;
    for (const p of typeOptions.fakerPaths) AC_ITEMS.push({ v: p.value, l: p.label });
    for (const t of typeOptions.dslTypes) AC_ITEMS.push({ v: t.example, l: t.label });
  }

  const ac = document.createElement('div');
  ac.className = 'ac';
  document.body.appendChild(ac);
  let acInput = null, acSel = -1, acList = [];

  function acClose() { ac.style.display = 'none'; acInput = null; acSel = -1; }

  function acRender(input) {
    if (input.readOnly || !AC_ITEMS.length) return;
    acInput = input;
    const q = input.value.trim().toLowerCase();
    acList = q ? AC_ITEMS.filter((it) => it.v.toLowerCase().includes(q) || it.l.toLowerCase().includes(q)) : AC_ITEMS;
    if (!acList.length) { ac.style.display = 'none'; return; }
    acSel = -1;
    ac.innerHTML = '';
    acList.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'ac-item';
      d.dataset.i = i;
      const v = document.createElement('span'); v.className = 'v'; v.textContent = it.v;
      const l = document.createElement('span'); l.className = 'l'; l.textContent = it.l;
      d.append(v, l);
      ac.appendChild(d);
    });
    const r = input.getBoundingClientRect();
    ac.style.display = 'block';
    ac.style.left = (r.left + scrollX) + 'px';
    ac.style.top = (r.bottom + scrollY + 4) + 'px';
    ac.style.width = Math.max(r.width, 280) + 'px';
    ac.scrollTop = 0;
  }

  function acHighlight() {
    [...ac.children].forEach((el, i) => el.classList.toggle('sel', i === acSel));
    if (acSel >= 0) ac.children[acSel].scrollIntoView({ block: 'nearest' });
  }

  function acApply(i) {
    if (!acInput || i < 0 || i >= acList.length) return;
    acInput.value = acList[i].v;
    const row = acInput.closest('.frow');
    acClose();
    applyLock(row);
    update();
  }

  ac.addEventListener('mousedown', (e) => {
    e.preventDefault(); // 포커스 유지 (blur 방지)
    const item = e.target.closest('.ac-item');
    if (item) acApply(parseInt(item.dataset.i, 10));
  });
  window.addEventListener('scroll', (e) => {
    if (e.target === ac || ac.contains(e.target)) return;
    acClose();
  }, true);
  window.addEventListener('resize', acClose);

  function readState() {
    const fields = [];
    for (const row of fieldsEl.querySelectorAll('.frow')) {
      const n = row.querySelector('.fname').value.trim();
      const v = row.querySelector('.fval').value.trim();
      if (n && v) fields.push([n, v]);
    }
    const opts = {};
    for (const [k, sel] of Object.entries(OPT_INPUTS)) {
      const v = String($(sel).value).trim();
      if (v !== '' && v !== OPT_DEFAULTS[k]) opts[k] = v;
    }
    return { res: $('#resource').value.trim() || 'items', fields, opts };
  }

  function buildQuery(state) {
    const parts = [];
    for (const [n, v] of state.fields) parts.push(enc(n) + '=' + enc(v));
    const alias = optAliases();
    for (const [k, v] of Object.entries(state.opts)) parts.push((alias[k] || k) + '=' + enc(v));
    // 값이 없어도 별칭 선언은 유지 — _s 저장 후 앱이 keyword=... 처럼 넘기는 시나리오
    const pairs = Object.entries(alias).map(([def, a]) => a + ':' + def);
    if (pairs.length) parts.push('_alias=' + enc(pairs.join(',')));
    return parts.join('&');
  }

  function encPath(res) {
    return res.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }

  function apiUrl(state) {
    return location.origin + '/api/' + encPath(state.res) + '?' + buildQuery(state);
  }

  // ---- GUI 상태 ↔ 주소창 (현재 URL 이 곧 GUI 상태) ----
  function syncAddressBar(state) {
    const q = (WS ? '_ws=' + WS + '&' : '') +
      '_res=' + enc(state.res) + (state.fields.length || Object.keys(state.opts).length ? '&' + buildQuery(state) : '');
    history.replaceState(null, '', '/?' + q + location.hash); // 해시(#en/#ko 언어 상태)는 보존
  }

  function loadFromAddressBar() {
    const params = new URLSearchParams(location.search);
    if (![...params.keys()].length || !params.has('_res')) return false;
    $('#resource').value = params.get('_res') || 'items';
    fieldsEl.innerHTML = '';
    const { rev, byDef } = parseAliasParam(params);
    setOptKeys(byDef);
    for (const [k, v] of params) {
      if (k === '_res' || k === '_alias') continue;
      const def = rev[k] || k;
      if (def in OPT_INPUTS) { $(OPT_INPUTS[def]).value = v; continue; }
      if (k.startsWith('_')) continue;
      addRow(k, v);
    }
    if (!fieldsEl.children.length) addRow();
    $('#optsAdv').open = advActive();
    return true;
  }

  function applyPreset(name) {
    loadedPreset = null; preloadSnapshot = null; // 내장 프리셋은 저장본과 무관
    const p = PRESETS[name];
    $('#resource').value = p.res;
    fieldsEl.innerHTML = '';
    for (const [n, v] of p.fields) addRow(n, v);
    setOptKeys(null); // 내장 프리셋은 기본 키 사용
    for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = (p.opts && p.opts[k]) || OPT_DEFAULTS[k];
    $('#optsAdv').open = advActive();
    update();
  }

  // ---- JSON 구문 하이라이팅 ----
  // 이 아래는 JS — CSS 는 스타일 블록에 있음
  function highlightJson(text) {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (m, str, colon, kw) => {
        if (str) return colon ? '<span class="j-key">' + str + '</span>' + colon : '<span class="j-str">' + str + '</span>';
        if (kw) return '<span class="j-kw">' + kw + '</span>';
        return '<span class="j-num">' + m + '</span>';
      },
    );
  }

  // NDJSON — 줄 번호 + 줄별 구문 하이라이팅
  function renderNdjson(text) {
    const MAX = 200;
    const lines = text.trimEnd().split('\n').filter((l) => l !== '');
    let html = '';
    lines.slice(0, MAX).forEach((l, i) => {
      html += '<div class="nd-row"><span class="nd-no">' + (i + 1) + '</span><span class="nd-json">' + highlightJson(l) + '</span></div>';
    });
    if (lines.length > MAX) html += '<div class="pv-more">' + t('… 외 ' + (lines.length - MAX) + '줄 — 미리보기는 ' + MAX + '줄까지 (복사는 전체)', '… ' + (lines.length - MAX) + ' more lines — preview shows up to ' + MAX + ' (copy gets everything)') + '</div>';
    $('#preview').innerHTML = html || t('(빈 응답)', '(empty response)');
  }

  // CSV — RFC 4180 파싱 후 표로
  function parseCsv(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
    return rows.filter((r) => r.length > 1 || r[0] !== '');
  }

  function renderCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 1) { $('#preview').textContent = text; return; }
    const MAX = 100;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let html = '<table class="csv-t"><thead><tr>' + rows[0].map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of rows.slice(1, MAX + 1)) {
      html += '<tr>' + r.map((c) => '<td title="' + esc(c).replace(/"/g, '&quot;') + '">' + esc(c) + '</td>').join('') + '</tr>';
    }
    html += '</tbody></table>';
    if (rows.length - 1 > MAX) html += '<div class="pv-more">' + t('… 외 ' + (rows.length - 1 - MAX) + '행 — 미리보기는 ' + MAX + '행까지 (복사는 전체)', '… ' + (rows.length - 1 - MAX) + ' more rows — preview shows up to ' + MAX + ' (copy gets everything)') + '</div>';
    $('#preview').innerHTML = html;
  }

  // ---- 미리보기 (디바운스 300ms) ----
  let timer = null; let reqSeq = 0; let lastPreviewText = '';
  /** 고급 옵션 중 하나라도 기본값이 아닌가 */
  function advActive() {
    return $('#oDelay').value !== '0' || $('#oStatus').value !== '200' ||
      $('#oWrap').value !== 'envelope' || $('#oSeed').value.trim() !== '' ||
      $('#oFormat').value !== 'json';
  }

  function update() {
    const state = readState();
    // 입력 중에는 절대 닫지 않는다 — 자동으로는 열기만.
    // (닫힘은 프리셋 전환·URL 로드 같은 문맥 전환 시점에만 advActive 기준으로)
    if (advActive()) $('#optsAdv').open = true;
    const url = apiUrl(state);
    $('#urlBox').innerHTML = '';
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.textContent = url;
    $('#urlBox').appendChild(a);
    // 저장된 프리셋 기반이면 짧은 URL + 프리셋 이름 표시, 드롭다운 선택 상태도 동기화
    // (자리는 항상 유지 — visibility 로만 토글해 레이아웃 점프 방지)
    const short = shortApiUrl(state);
    $('#shortLine').classList.toggle('ghosted', !short);
    if (short) {
      const sa = $('#shortA');
      sa.href = short; sa.textContent = short;
      $('#shortLine').dataset.url = short;
      $('#shortLine').querySelector('.stag').textContent = loadedPreset.name ? loadedPreset.name : t('짧은 URL', 'Short URL');
      $('#teamSel').value = loadedPreset.sid;
      $('#teamSel').classList.add('active'); // 선택됨 — 진한 표시
    } else {
      $('#teamSel').value = ''; // 저장본과 달라짐 → 선택 해제
      $('#teamSel').classList.remove('active');
    }
    syncAddressBar(state);
    clearTimeout(timer);
    timer = setTimeout(() => preview(url), 300);
  }

  let loadingTimer = null;
  function setLoading(on) {
    $('#statusLine').style.opacity = on ? '.4' : '';
    $('#preview').style.opacity = on ? '.55' : '';
  }

  async function preview(url) {
    const seq = ++reqSeq;
    const t0 = performance.now();
    // 빠른 응답(<250ms)은 로딩 표시 없이 조용히 교체 — 깜빡임 방지.
    // 느린 응답(_delay 등)만 기존 내용을 흐리게 해서 진행 중임을 알림.
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => setLoading(true), 250);
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': LANG } });
      const text = await res.text();
      if (seq !== reqSeq) return; // 오래된 응답 무시
      clearTimeout(loadingTimer);
      setLoading(false);
      const ms = Math.round(performance.now() - t0);
      const cls = res.ok ? 'ok' : 'err';
      $('#statusLine').innerHTML = 'HTTP <span class="' + cls + '">' + res.status + '</span> · ' + ms + 'ms';
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('x-ndjson')) {
        lastPreviewText = text;
        renderNdjson(text);
      } else if (ct.includes('text/csv')) {
        lastPreviewText = text;
        renderCsv(text);
      } else {
        let body = text;
        let isJson = false;
        try { body = JSON.stringify(JSON.parse(text), null, 2); isJson = true; } catch {}
        lastPreviewText = body;
        if (isJson) $('#preview').innerHTML = highlightJson(body);
        else $('#preview').textContent = body;
      }
    } catch (e) {
      if (seq !== reqSeq) return;
      clearTimeout(loadingTimer);
      setLoading(false);
      $('#statusLine').innerHTML = '<span class="err">' + t('요청 실패', 'Request failed') + '</span>';
      lastPreviewText = String(e);
      $('#preview').textContent = String(e);
    }
  }

  // ---- JSON 붙여넣기 → 추론 ----
  function openPaste() {
    $('#pasteError').textContent = '';
    $('#pasteModal').style.display = 'flex';
    $('#pasteInput').focus();
  }
  function closePaste() { $('#pasteModal').style.display = 'none'; }

  async function applyPaste() {
    const raw = $('#pasteInput').value.trim();
    if (!raw) { $('#pasteError').textContent = t('JSON 을 입력하세요.', 'Enter some JSON.'); return; }
    // "data": {...} 처럼 바깥 중괄호 없는 조각도 감싸서 재시도
    let body = null;
    for (const candidate of [raw, '{' + raw + '}', '{' + raw.replace(/,\s*$/, '') + '}']) {
      try { JSON.parse(candidate); body = candidate; break; } catch {}
    }
    if (body === null) {
      try { JSON.parse(raw); }
      catch (e) { $('#pasteError').textContent = t('JSON 파싱 실패: ', 'JSON parse error: ') + e.message; return; }
    }
    let result;
    try {
      const res = await fetch('/schema/infer', { method: 'POST', body, headers: { 'content-type': 'application/json', 'Accept-Language': LANG } });
      result = await res.json();
      if (!res.ok) { $('#pasteError').textContent = (result.error || t('추론 실패', 'Inference failed')) + (result.hint ? ' — ' + result.hint : ''); return; }
    } catch (e) { $('#pasteError').textContent = t('요청 실패: ', 'Request failed: ') + e; return; }
    loadedPreset = null; preloadSnapshot = null; // 붙여넣기로 새 스키마 시작 — 저장본과 무관
    fieldsEl.innerHTML = '';
    for (const f of result.fields) addRow(f.name, f.type);
    const note = $('#inferNote');
    const lines = [];
    if (result.note) lines.push('ℹ ' + result.note);
    if (result.skipped && result.skipped.length) {
      lines.push(t('추론에서 제외됨:', 'Excluded from inference:'));
      for (const s of result.skipped) lines.push('· ' + s.path + ' — ' + s.reason);
    }
    if (lines.length) {
      note.textContent = lines.join('\n');
      note.style.display = 'block';
      clearTimeout(note._t); note._t = setTimeout(() => (note.style.display = 'none'), 15000);
    } else {
      note.style.display = 'none';
    }
    closePaste();
    update();
  }

  // ---- 워크스페이스 (링크를 아는 사람만 접근하는 저장 공간) ----
  let WS = null; // null = 워크스페이스 미사용 (프리셋 기능 비활성)

  function randWs() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let s = '';
    for (const b of bytes) s += (b % 36).toString(36);
    return s.slice(0, 12);
  }

  function sidOf(id) { return WS ? WS + '.' + id : id; }

  function syncWsUi() {
    const btn = $('#wsBtn');
    const inWs = !!WS;
    $('#wsBtnLabel').textContent = inWs ? WS.slice(0, 8) + '…' : t('워크스페이스', 'Workspace');
    btn.classList.toggle('ws-on', inWs);
    btn.title = inWs ? t('현재 워크스페이스: ', 'Current workspace: ') + WS : t('프리셋 저장·공유 공간 만들기/전환', 'Create or switch a preset workspace');
    $('#wsCurrent').textContent = inWs ? t('현재 워크스페이스: ', 'Current workspace: ') + WS : t('아직 워크스페이스를 사용하고 있지 않습니다.', 'You are not in a workspace yet.');
    // 상태에 맞는 동작만 노출: 링크 복사/나가기는 워크스페이스 안에서만 의미가 있음
    $('#wsShare').style.display = inWs ? '' : 'none';
    $('#wsPublic').style.display = inWs ? '' : 'none';
    // 만들기는 밖에서는 주요 동작(파랑), 안에서는 보조 동작(연파랑)
    $('#wsNew').style.background = inWs ? 'var(--accent-soft)' : 'var(--accent)';
    $('#wsNew').style.color = inWs ? 'var(--ink)' : 'var(--accent-text)';
  }

  function switchWs(ws) {
    WS = ws;
    loadedPreset = null; preloadSnapshot = null;
    syncWsUi();
    refreshTeam();
    update();
  }

  /** 붙여넣은 값에서 워크스페이스 ID 추출 — 순수 ID / 링크(_ws=) / sid(ws.id) 모두 허용 */
  function parseWsInput(raw) {
    raw = (raw || '').trim();
    if (!raw) return null;
    try {
      if (raw.includes('://') || raw.includes('?')) {
        const u = new URL(raw, location.origin);
        const fromWs = u.searchParams.get('_ws');
        if (fromWs && /^[a-z0-9]{6,24}$/.test(fromWs)) return fromWs;
        const fromSid = u.searchParams.get('_s');
        if (fromSid && fromSid.includes('.')) raw = fromSid;
        else return null;
      }
    } catch { return null; }
    const dot = raw.indexOf('.');
    if (dot > 0) raw = raw.slice(0, dot); // sid(ws.id) → ws 부분
    return /^[a-z0-9]{6,24}$/.test(raw) ? raw : null;
  }

  function joinWs() {
    const ws = parseWsInput($('#wsJoin').value);
    if (!ws) {
      $('#wsJoinError').textContent = t('워크스페이스 ID 를 인식할 수 없습니다. 소문자 영숫자 6~24자, 또는 _ws= 가 포함된 링크를 붙여넣으세요.', 'Could not recognize a workspace ID. Paste 6-24 lowercase letters/digits, or a link containing _ws=.');
      return;
    }
    $('#wsJoinError').textContent = '';
    $('#wsJoin').value = '';
    switchWs(ws);
  }

  // ---- 팀 스키마 저장/불러오기 ----
  // KV 미설정이면: 저장 버튼은 보이되 클릭 시 활성화 안내, 팀 프리셋 목록만 숨김
  let teamAvailable = false;
  let teamItems = [];

  // 모바일에선 프리셋 버튼을 숨기고 이 드롭다운 하나로 통합 (기본은 optgroup 구분)
  const presetMql = window.matchMedia('(max-width: 640px)');

  function renderTeamOptions() {
    const sel = $('#teamSel');
    const mobile = presetMql.matches;
    sel.innerHTML = '<option value="">' + (mobile ? t('프리셋 선택…', 'Choose a preset…') : t('저장된 프리셋…', 'Saved presets…')) + '</option>';
    if (mobile) {
      const g = document.createElement('optgroup');
      g.label = t('기본 프리셋', 'Built-in presets');
      for (const [k, label] of [['users', t('사용자', 'Users')], ['products', t('상품', 'Products')], ['orders', t('주문 상세', 'Order detail')]]) {
        const o = document.createElement('option');
        o.value = 'preset:' + k;
        o.textContent = label;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    const parent = mobile && WS ? (() => { const g = document.createElement('optgroup'); g.label = t('내 프리셋', 'My presets'); sel.appendChild(g); return g; })() : sel;
    if (WS && teamItems.length === 0) {
      const o = document.createElement('option');
      o.disabled = true;
      o.textContent = t('아직 없음 — "프리셋으로 저장"으로 첫 항목을 만들어보세요', 'Nothing yet — use "Save as preset" to create the first one');
      parent.appendChild(o);
    }
    for (const it of teamItems) {
      const o = document.createElement('option');
      o.value = it.sid;
      o.textContent = it.name + ' (/api/' + it.res + ')';
      parent.appendChild(o);
    }
    if (loadedPreset) sel.value = loadedPreset.sid; // 목록 갱신 후에도 현재 프리셋 유지
  }

  /** 모바일이면 워크스페이스 없이도 드롭다운 노출 (기본 프리셋 접근 경로) */
  function syncTeamSelVisibility() {
    $('#teamSel').style.display = (WS || presetMql.matches) ? '' : 'none';
  }
  if (presetMql.addEventListener) presetMql.addEventListener('change', () => { renderTeamOptions(); syncTeamSelVisibility(); });

  async function refreshTeam() {
    try {
      const res = await fetch('/schema/saved' + (WS ? '?ws=' + WS : ''), { headers: { 'Accept-Language': LANG } });
      if (!res.ok) return; // 501 = KV 미설정
      const body = await res.json();
      teamAvailable = true;
      $('#wsBtn').style.display = '';
      syncWsUi();
      teamItems = body.items;
      syncTeamSelVisibility();
      renderTeamOptions();
    } catch {}
  }

  function applyQueryString(res, query) {
    $('#resource').value = res;
    fieldsEl.innerHTML = '';
    for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = OPT_DEFAULTS[k];
    const qp = new URLSearchParams(query);
    const { rev, byDef } = parseAliasParam(qp);
    setOptKeys(byDef);
    for (const [k, v] of qp) {
      if (k === '_alias') continue;
      const def = rev[k] || k;
      if (def in OPT_INPUTS) { $(OPT_INPUTS[def]).value = v; continue; }
      if (k.startsWith('_')) continue;
      addRow(k, v);
    }
    if (!fieldsEl.children.length) addRow();
    $('#optsAdv').open = advActive();
    update();
  }

  // 현재 불러온/저장한 프리셋 — 짧은 URL 표시의 근거
  let loadedPreset = null; // { id, res, query(정규형) }

  let preloadSnapshot = null; // 저장 프리셋을 처음 선택하기 직전의 편집 상태

  async function loadTeamPreset(sid) {
    try {
      const res = await fetch('/schema/saved/' + sid, { headers: { 'Accept-Language': LANG } });
      if (!res.ok) return;
      const rec = await res.json();
      if (!loadedPreset) {
        const s = readState();
        preloadSnapshot = { res: s.res, query: buildQuery(s) };
      }
      loadedPreset = { sid: rec.sid, res: rec.res, query: rec.query, name: rec.name };
      applyQueryString(rec.res, rec.query);
    } catch {}
  }

  /** '저장된 프리셋…'(빈 값) 선택 = 해제 → 선택 전 편집 상태로 복원 */
  function unloadTeamPreset() {
    if (!loadedPreset) return;
    loadedPreset = null;
    const snap = preloadSnapshot; // 초기화보다 먼저 읽는다
    preloadSnapshot = null;
    $('#teamSel').classList.remove('active');
    if (snap) applyQueryString(snap.res, snap.query);
    else update();
  }

  /**
   * 짧은 URL 계산 — 저장본과 현재 상태를 비교해:
   * 예약 옵션/필드 값 변경·추가는 _s 뒤 오버라이드로 표현,
   * 저장본 필드의 삭제·이름변경은 표현 불가 → null (숨김)
   */
  function shortApiUrl(state) {
    if (!loadedPreset) return null;
    const saved = new URLSearchParams(loadedPreset.query);
    const cur = new URLSearchParams(buildQuery(state));
    for (const [k] of saved) {
      if (!k.startsWith('_') && !cur.has(k)) return null; // 필드 삭제됨
    }
    const overrides = [];
    for (const [k, v] of cur) {
      if (saved.get(k) !== v) overrides.push(enc(k) + '=' + enc(v));
    }
    for (const k of Object.keys(OPT_DEFAULTS)) {
      if (saved.has(k) && !cur.has(k)) overrides.push(k + '=' + OPT_DEFAULTS[k]); // 기본값으로 되돌림도 명시
    }
    return location.origin + '/api/' + encPath(state.res) +
      '?_s=' + loadedPreset.sid + (overrides.length ? '&' + overrides.join('&') : '');
  }

  function openSave() {
    $('#saveError').textContent = '';
    $('#saveResult').style.display = 'none';
    const kvReady = teamAvailable;
    const wsReady = kvReady && !!WS; // 저장은 워크스페이스 전용
    $('#saveSetup').style.display = kvReady ? 'none' : 'block';
    $('#saveWsRequired').style.display = kvReady && !WS ? 'block' : 'none';
    $('#saveName').style.display = wsReady ? '' : 'none';
    $('#saveApply').style.display = wsReady ? '' : 'none';
    $('#saveModal').style.display = 'flex';
    if (wsReady) $('#saveName').focus();
  }

  async function applySave() {
    const name = $('#saveName').value.trim();
    if (!name) { $('#saveError').textContent = t('이름을 입력하세요.', 'Enter a name.'); return; }
    const state = readState();
    try {
      const res = await fetch('/schema/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Accept-Language': LANG },
        body: JSON.stringify({ name, res: state.res, query: buildQuery(state), ws: WS || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        $('#saveError').textContent = (res.status === 429 || res.status === 503)
          ? (body.hint || t('지금은 저장할 수 없습니다. 잠시 후 다시 시도하세요.', 'Cannot save right now. Try again shortly.'))
          : (body.error || t('저장 실패', 'Save failed')) + (body.hint ? ' — ' + body.hint : '');
        return;
      }
      $('#saveError').textContent = '';
      const shortUrl = location.origin + body.apiUrl;
      $('#shortUrlBox').textContent = shortUrl;
      $('#shortUrlBox').dataset.url = shortUrl;
      // 저장 완료 상태로 전환 — 입력칸과 저장 버튼은 치우고 결과만
      $('#saveName').style.display = 'none';
      $('#saveApply').style.display = 'none';
      $('#saveResult').style.display = 'block';
      loadedPreset = { sid: body.sid, res: body.res, query: body.query, name: body.name }; // 이후 URL 박스에도 짧은 URL 상시 표시
      refreshTeam();
      update();
    } catch (e) {
      $('#saveError').textContent = t('요청 실패: ', 'Request failed: ') + e;
    }
  }

  // ---- TypeScript 타입 복사 ----
  async function copyTsTypes(btn) {
    const state = readState();
    try {
      const res = await fetch('/schema/ts?' + buildQuery(state) + '&_res=' + enc(state.res), { headers: { 'Accept-Language': LANG } });
      const text = await res.text();
      if (!res.ok) { btn.textContent = t('URL 오류', 'Bad URL'); setTimeout(() => (btn.textContent = t('TS 타입 복사', 'Copy TS types')), 1500); return; }
      copyText(text, btn, t('복사됨 ✓', 'Copied ✓'));
    } catch {
      btn.textContent = t('요청 실패', 'Request failed'); setTimeout(() => (btn.textContent = t('TS 타입 복사', 'Copy TS types')), 1500);
    }
  }

  // ---- 클립보드 ----
  async function writeClipboard(t) {
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
  }

  async function copyText(t, btn, done) {
    await writeClipboard(t);
    const orig = btn.textContent;
    btn.textContent = done; setTimeout(() => (btn.textContent = orig), 1200);
  }

  // 아이콘 복사 버튼 (lucide copy/check)
  const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#23a55a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  async function copyIcon(t, btn) {
    await writeClipboard(t);
    btn.innerHTML = ICON_CHECK;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => (btn.innerHTML = ICON_COPY), 1200);
  }

  // ---- 이벤트 ----
  document.addEventListener('input', (e) => {
    if (e.target.matches('.fname, .fval, #resource, .opts input, .opts select')) {
      if (e.target.matches('.fname, .fval')) e.target.title = e.target.value;
      if (e.target.matches('.fval')) acRender(e.target);
      update();
    }
  });
  // 모바일: 키보드만 내린 상태(포커스 유지)에서 재탭하면 focus 이벤트가 없어
  // 드롭다운이 안 열리던 문제 — 탭(click)에도 자동완성을 연다
  document.addEventListener('click', (e) => {
    if (e.target.matches && e.target.matches('.fval')) acRender(e.target);
  });
  document.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('.fval')) acRender(e.target);
  });
  // 잠금은 입력이 끝난 뒤(blur)에만 적용 — 타이핑 중에 잠기지 않도록
  document.addEventListener('focusout', (e) => {
    if (e.target.matches && e.target.matches('.fval')) {
      applyLock(e.target.closest('.frow'));
      acClose();
    }
  });
  // 잠긴 타입(uuid/index)도 더블클릭하면 직접 수정 가능
  document.addEventListener('dblclick', (e) => {
    if (e.target.matches('.fval.locked')) {
      e.target.readOnly = false;
      e.target.classList.remove('locked');
      e.target.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'wsJoin') { joinWs(); return; }
    if (acInput && ac.style.display === 'block') {
      if (e.key === 'ArrowDown') { e.preventDefault(); acSel = Math.min(acSel + 1, acList.length - 1); acHighlight(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acSel = Math.max(acSel - 1, 0); acHighlight(); return; }
      if (e.key === 'Enter' && acSel >= 0) { e.preventDefault(); acApply(acSel); return; }
      if (e.key === 'Escape') { acClose(); return; }
    }
    if (e.key === 'Escape') { closePaste(); $('#helpModal').style.display = 'none'; $('#saveModal').style.display = 'none'; $('#wsModal').style.display = 'none'; }
  });
  // ---- 모달 배경 스크롤 잠금 (iOS 는 overflow:hidden 만으론 안 됨 → body fixed) ----
  const MODAL_IDS = ['pasteModal', 'helpModal', 'saveModal', 'wsModal', 'newsModal', 'fbModal'];
  let scrollLockY = 0;
  function syncScrollLock() {
    const anyOpen = MODAL_IDS.some((id) => { const el = $('#' + id); return el && el.style.display === 'flex'; });
    const locked = document.body.style.position === 'fixed';
    if (anyOpen && !locked) {
      scrollLockY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = -scrollLockY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
    } else if (!anyOpen && locked) {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollLockY);
    }
  }
  syncTeamSelVisibility();
  renderTeamOptions();
  hardenInputs();

  const modalObserver = new MutationObserver(syncScrollLock);
  for (const id of MODAL_IDS) {
    const el = $('#' + id);
    if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
  }

  document.addEventListener('change', (e) => {
    if (e.target.id === 'teamSel') {
      const v = e.target.value;
      if (v.startsWith('preset:')) { applyPreset(v.slice(7)); e.target.value = ''; }
      else if (v) loadTeamPreset(v); // 선택 상태 유지
      else unloadTeamPreset(); // placeholder 재선택 = 해제 + 이전 상태 복원
    }
  });
  document.addEventListener('click', (e) => {
    // 버튼 안 SVG/span 클릭도 인식하도록 closest 기반으로 판별
    const btn = e.target.closest ? e.target.closest('button, a') : null;
    if (!btn) {
      // 모달 오버레이(배경) 클릭 → 닫기
      const oid = e.target.id;
      if (oid === 'pasteModal') closePaste();
      else if (oid === 'helpModal') $('#helpModal').style.display = 'none';
      else if (oid === 'wsModal') $('#wsModal').style.display = 'none';
      else if (oid === 'saveModal') $('#saveModal').style.display = 'none';
      return;
    }
    if (btn.classList.contains('del')) { btn.closest('.frow').remove(); update(); return; }
    if (btn.dataset && btn.dataset.preset) { applyPreset(btn.dataset.preset); return; }
    switch (btn.id) {
      // 언어 토글 — 해시만 바꾸고 리로드 (스키마 상태는 location.search 에 있어 안전)
      case 'langBtn': location.hash = LANG === 'en' ? '#ko' : '#en'; location.reload(); break;
      case 'addField': addRow(); break;
      case 'pasteBtn': case 'welcomePaste': openPaste(); break;
      case 'pasteCancel': closePaste(); break;
      case 'pasteApply': applyPaste(); break;
      case 'helpBtn': case 'helpLink': case 'welcomeHelp':
        e.preventDefault(); $('#helpModal').style.display = 'flex'; break;
      case 'helpClose': $('#helpModal').style.display = 'none'; break;
      case 'newsBtn': $('#newsModal').style.display = 'flex'; break;
      case 'newsClose': $('#newsModal').style.display = 'none'; break;
      case 'fbBtn':
        $('#fbStatus').textContent = '';
        $('#fbModal').style.display = 'flex';
        $('#fbText').focus();
        break;
      case 'fbClose': $('#fbModal').style.display = 'none'; break;
      case 'fbSend': {
        const msg = $('#fbText').value.trim();
        const st = $('#fbStatus');
        if (msg.length < 5) { st.style.color = 'var(--danger)'; st.textContent = t('5자 이상 적어주세요.', 'Please write at least 5 characters.'); break; }
        st.style.color = 'var(--muted)'; st.textContent = t('보내는 중…', 'Sending…');
        fetch('/feedback', { method: 'POST', headers: { 'content-type': 'application/json', 'Accept-Language': LANG }, body: JSON.stringify({ msg }) })
          .then(async (r) => {
            const b = await r.json();
            if (r.ok) {
              st.style.color = 'var(--ok)'; st.textContent = b.hint || t('전달됐어요 — 고맙습니다!', 'Delivered — thank you!');
              $('#fbText').value = '';
              setTimeout(() => { $('#fbModal').style.display = 'none'; }, 1200);
            } else {
              st.style.color = 'var(--danger)'; st.textContent = b.hint || t('전송에 실패했어요.', 'Failed to send.');
            }
          })
          .catch(() => { st.style.color = 'var(--danger)'; st.textContent = t('네트워크 오류 — 잠시 후 다시 시도해주세요.', 'Network error — please try again shortly.'); });
        break;
      }
      case 'welcomeClose': $('#welcome').style.display = 'none'; break;
      case 'copyBtn': copyIcon(apiUrl(readState()), btn); break;
      case 'tsBtn': copyTsTypes(btn); break;
      case 'respCopyBtn': copyIcon(lastPreviewText, btn); break;
      case 'saveBtn': openSave(); break;
      case 'wsBtn': syncWsUi(); $('#wsModal').style.display = 'flex'; break;
      case 'wsClose': $('#wsModal').style.display = 'none'; break;
      case 'wsNew': switchWs(randWs()); break;
      case 'wsPublic': switchWs(null); break;
      case 'wsShare': copyText(location.href, btn, t('복사됨 ✓', 'Copied ✓')); break;
      case 'wsJoinBtn': joinWs(); break;
      case 'saveWsCreate': switchWs(randWs()); openSave(); break; // 새 워크스페이스 → 저장 이어서
      case 'saveWsJoin': $('#saveModal').style.display = 'none'; syncWsUi(); $('#wsModal').style.display = 'flex'; break;
      case 'saveCancel': $('#saveModal').style.display = 'none'; break;
      case 'saveApply': applySave(); break;
      case 'shortCopy': copyIcon($('#shortUrlBox').dataset.url || '', btn); break;
      case 'shortLineCopy': copyIcon($('#shortLine').dataset.url || '', btn); break;
    }
  });

  // ---- 초기화 ----
  (async () => {
    // 워크스페이스는 URL 이 곧 상태 — _ws 파라미터로 복원
    const wsParam = new URLSearchParams(location.search).get('_ws');
    if (wsParam && /^[a-z0-9]{6,24}$/.test(wsParam)) WS = wsParam;
    try {
      typeOptions = await (await fetch('/schema/types', { headers: { 'Accept-Language': LANG } })).json();
    } catch { typeOptions = { fakerPaths: [], dslTypes: [] }; }
    buildAcItems();
    refreshTeam();
    // 복사 버튼들을 아이콘으로 초기화
    for (const id of ['copyBtn', 'shortCopy', 'shortLineCopy', 'respCopyBtn']) {
      const b = $('#' + id);
      if (b) b.innerHTML = ICON_COPY;
    }
    if (!loadFromAddressBar()) {
      // 첫 방문(맨 주소): 사용자 프리셋으로 온보딩 + 웰컴 배너.
      // 공유 링크로 들어오면 URL 에 스키마가 있으므로 배너를 띄우지 않는다.
      const p = PRESETS.users;
      $('#resource').value = p.res;
      for (const [n, v] of p.fields) addRow(n, v);
      setOptKeys(null);
      for (const [k, sel] of Object.entries(OPT_INPUTS)) $(sel).value = (p.opts && p.opts[k]) || OPT_DEFAULTS[k];
      $('#optsAdv').open = advActive();
      $('#welcome').style.display = 'block';
    }
    update();
  })();
})();
