# <img src="./assets/logo.svg" height="30" alt="mocappi logo"> mocappi

A mock REST API you define entirely in the URL. No app to install, no config to commit, no redeploy — edit the query string and you're done. **The same URL always returns the same data.**

[한국어 문서 (Korean)](./README.ko.md)

**Live demo:** https://mocappi.gojongwon.workers.dev

- GUI (URL builder + live preview): `GET /`
- Data: `GET | POST | PUT | PATCH | DELETE /api/<resource>?field=type&...`
- Supported types: `GET /schema/types`
- Infer a schema from example JSON: `POST /schema/infer`
- Generate TypeScript types: `GET /schema/ts` (or the "TS 타입 복사" button in the GUI)

## Quick start

**Use it:** open the deployed worker URL — the GUI loads. Click a preset, or paste a real API response into **JSON paste** and a schema is inferred automatically. Copy the URL and `fetch` it.

**Deploy your own:**

```bash
git clone https://github.com/gojongwon/mocappi.git && cd mocappi
npm install
npx wrangler login
npm run deploy
```

## Examples

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

Nested objects and arrays:

```
/api/users?name=person.fullName&address.city=location.city&tags[]=lorem.word:3
```

Search (filtered items + match-count `total` — the data itself is unchanged, `_q` only filters):

```
/api/users?name=person.fullName&city=location.city&_q=kim&_locale=en
/api/users?name=person.fullName&city=location.city&_q=kim&_qin=name   # search only the name field
```

Nested paths and detail endpoints — any `/api/...` depth works (the path is cosmetic; data is determined by the query). Combine `_wrap=one` with `_seed=<id>` for per-id detail objects:

```
/api/v2/users/123/orders?id=uuid&amount=int:1000~90000&_seed=123
/api/users/123?name=person.fullName&age=int:20~60&_wrap=one&_seed=123
```

Loading and error-state testing:

```
/api/products?name=commerce.productName&_delay=3000      # 3s delay
/api/orders?id=uuid&_status=500                          # forced status code → failure body
```

## HTTP methods

The request body is ignored — what a mock owes you is the right **response shape and status**.

| Method | Status | Body |
|---|---|---|
| `GET` / `HEAD` | 200 | List (per `_wrap`) |
| `POST` | 201 | The single created item |
| `PUT` / `PATCH` | 200 | The single updated item |
| `DELETE` | 204 | Empty |

The single item a write method returns is byte-identical to item 0 of the matching `GET` list —
the method changes the shape, never the data.

Generated URLs are method-neutral — the method comes from your request, not the query string.
Pick a method in the GUI and it sends that verb for real; the URL you copy stays clean:

```
curl -X POST /api/users?name=person.fullName      # 201 + single item
```

`_method` is the escape hatch for hand-written URLs — it overrides the actual verb, so a plain
browser GET can preview a POST response:

```
/api/users?name=person.fullName&_method=post      # same response, plain GET
```

## Failure responses

`_status` at 400 or above replaces the data with a failure body:

```
/api/users?name=person.fullName&_status=404
→ 404 { "error": "Not Found", "status": 404, "message": "The requested resource was not found." }
```

Use `_body` for your own error shape (raw JSON, max 2000 chars, only with `_status` ≥ 400):

```
/api/users?name=person.fullName&_status=401&_body={"code":"E_AUTH","message":"Token expired"}
→ 401 { "code": "E_AUTH", "message": "Token expired" }
```

Failure wins over everything — the body is JSON even with `_format=csv`, and even for `DELETE`.
Statuses below 400 (e.g. `_status=302`) keep the normal data and only change the code.
`_body` cannot contain a literal `&` (it would split the query when saved as a preset) — write it as `&` inside the JSON.

## Reserved parameters (prefix `_`)

| Param | Default | Description |
|---|---|---|
| `_page` | 1 | Page number (1-based) |
| `_limit` | 10 | Items per page (max 1000) |
| `_total` | 100 | Virtual total count |
| `_seed` | URL hash | Explicit seed |
| `_locale` | ko | `ko` \| `en` \| `ja` \| `zh` |
| `_delay` | 0 | Response delay in ms (max 5000) |
| `_status` | 200 | Forced HTTP status code. At 400+ a failure body replaces the data |
| `_method` | actual verb | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` — takes precedence over the actual verb |
| `_body` | — | Failure response body (raw JSON, max 2000 chars). Only with `_status` ≥ 400 |
| `_wrap` | envelope | `envelope` \| `none` (bare array) \| `one` (single object — detail endpoints) |
| `_format` | json | `json` \| `ndjson` \| `csv` — ndjson/csv stream items only |
| `_q` | — | Search: case-insensitive substring over generated values; `total` becomes the match count (scans the first 1,000 virtual items) |
| `_qin` | — | Limit search to specific fields (comma-separated, dot paths). Use with `_q`: `_q=kim&_qin=name,city` |
| `_alias` | — | Rename reserved params to match your real API: `_alias=page:_page,size:_limit,keyword:_q` → call with `?page=2&size=20&keyword=kim` |
| `_s` | — | Saved schema ID (see Workspaces) |

Anything not starting with `_` is a field definition.

**Param aliases** let mock URLs use your real API's parameter names — combined with a saved schema, the frontend can call the mock exactly like production:

```
save:  name=person.fullName&_alias=page:_page,size:_limit,keyword:_q
call:  /api/users?_s=<id>&page=2&size=20&keyword=kim
```

## Field type DSL

```
name=person.fullName          # faker path (module.method)
age=int:20~60                 # integer range
price=float:0~100:2           # float range + decimals
active=bool:0.8               # 80% true
role=enum:admin|user|guest    # one of
type=const:user               # literal
bio=text:50                   # fixed-length string
avatar=image:200x200          # placeholder image URL
createdAt=date:2020-01-01~2024-12-31
id=uuid
seq=index                     # global index (0,1,2…)
sku=pattern:ORD-####-???      # pattern — # digit, ? uppercase, * alphanumeric
                              #   (in raw URLs encode # as %23 — the GUI does this for you)
status=enum:paid*8|refund*2   # weighted choice
email=internet.email?0.2      # 20% null — append ?p to any type
name=mask.name                # masked PII — "J*** Smith"
tel=mask.phone                #   "(212) ***-0187" (mask.email / mask.card too)
address.city=location.city    # dot notation → nested object
tags[]=lorem.word:3           # array — trailing :N is length (default 3)
```

Full list at `GET /schema/types`. Invalid DSL returns a 400 that explains what's wrong and how to fix it.

## Large datasets

`_limit` goes up to **1000**, and `_format=ndjson` / `_format=csv` stream items line by line (no envelope) — ideal for infinite scroll, virtualized lists, and data pipelines:

```
/api/logs?id=uuid&level=enum:info*8|warn*2&at=date:2026-01-01~2026-12-31&_limit=1000&_format=ndjson
/api/users?name=person.fullName&age=int:20~60&_limit=1000&_format=csv
```

The data is identical across formats (`_format` does not affect the seed). CSV flattens nested objects into dot-notation columns and JSON-encodes arrays (RFC 4180 escaping).

Note (free plan): the 10ms CPU budget comfortably fits ~1000 mixed-schema items. If every field is a faker path, large pages may hit the limit — split into pages:

```bash
for p in 1 2 3 4 5; do curl -s "https://<worker>/api/users?...&_limit=1000&_page=$p&_format=ndjson"; done > all.ndjson
```

## Determinism

- The same URL always returns byte-identical responses.
- Per-item seeding: the global *i*-th item is stable even when `_page`/`_limit` change.
- Field order, `_delay`, and `_status` don't affect the data.
- faker `date.*` uses a pinned refDate so values don't drift over time.

Note: upgrading the faker library may change generated values — pin the version while using snapshots.

## Safe contact data

Mock data should never reach a real person:

- `internet.email` always generates `@example.com` addresses — an IANA-reserved domain (RFC 2606), guaranteed undeliverable, with readable ASCII usernames.
- `phone.number` generates well-formed numbers: `010-####-####` (ko), `090-####-####` (ja), `1[3-9]#########` (zh), and the fiction-reserved `(###) 555-01##` range (en) — so format validation and masking logic still work.

## Workspaces (multi-team / public use)

Storage is isolated by **workspace** — a capability-URL model with no login:

- **Saving requires a workspace** — the public pool is read-only. Header storage button → "새 워크스페이스 만들기" → share the link (`/?_ws=<ID>`) with your team. You can also paste a received ID/link in the same modal to switch.
- Only people who know the link see that workspace's preset list.
- Short URLs: `?_s=<ws>.<id>` (public pool: `?_s=<id>`).
- Limits: 100 saved schemas per workspace; workspace entries expire after 180 days of no re-save (public pool is permanent).

Saved schemas are **content-addressed and immutable**: the ID is a hash of the content, so a shared `_s=` URL returns the same data forever. Editing and re-saving produces a new ID.

### Enable team storage (once)

**Recommended — D1** (free tier: 100,000 writes/day, 100× KV):

```bash
npx wrangler d1 create mock-api
# paste the printed database_id into the commented [[d1_databases]] block in wrangler.toml and uncomment it
npm run deploy
```

The table is created automatically on first use. KV (`[[kv_namespaces]]`, binding `SCHEMAS`) still works as a fallback — if both are bound, D1 wins. Existing KV data is not migrated automatically; with few presets, just re-save them.

Without either binding everything else works; only the save UI is disabled.

### Operating publicly

- Save rate limiting **ships with the repo** — `wrangler.toml` includes a Workers Rate Limiting binding (`SAVE_RL`, burst guard) that works on `workers.dev` and activates automatically on deploy, plus an in-Worker cap of **10 saves/hour/IP** (429 with a clear message). The Worker also skips redundant re-writes of identical content. No dashboard setup needed.
  - Zone WAF rate limiting rules are only available if you serve the Worker on a custom domain you own — optional extra layer in that case.
- Reading user feedback (GUI 피드백 button, 90-day TTL). With D1:

  ```bash
  npx wrangler d1 execute mock-api --remote --command "SELECT value FROM kv WHERE key LIKE 'fb:%' ORDER BY key DESC"
  ```

  (KV fallback: `npx wrangler kv key list --binding=SCHEMAS --prefix=fb:` then `kv key get` per key.)

- Set usage alerts (free tier: 100K req/day, 1K KV writes/day). Move to Workers Paid ($5/mo) if traffic grows.

## TypeScript types

The **TS 타입 복사** button (or `GET /schema/ts?<schema>&_res=<resource>`) generates an interface for the current schema, a generic `Paginated<T>` envelope, and a `fetchMock<T>` helper. `enum:a|b|c` becomes the literal union `'a' | 'b' | 'c'`.

```ts
const res = await fetchMock<User>(url);
res.data[0].name; // autocompleted & type-checked
```

## Development

```bash
npm install
npm test            # vitest (determinism / DSL / worker / store)
npm run typecheck
npm run dev         # wrangler dev → http://localhost:8787 (local simulated KV)
npm run size        # bundle gzip size (3MB free-plan limit)
npm run deploy
```

Local dev uses a simulated KV stored under `.wrangler/state/` — it does not touch production data. Use `wrangler dev --remote` to develop against real bindings.

## Structure

```
src/
  index.ts     # router (/, /api/:resource, /schema/*) + CORS + _delay/_status
  dsl.ts       # query string → schema parsing + friendly errors
  registry.ts  # type registry (type name → generator) + /schema/types docs
  generate.ts  # per-item seeded generation + pagination
  store.ts     # KV storage — content-addressed, workspaces
  tstype.ts    # schema → TypeScript types
  rng.ts       # FNV-1a hash + mulberry32 PRNG
  gui/         # GUI source — index.html + app.css + app.js
build/gui.mjs  # inlines the GUI source into one HTML file (src/gui.generated.html)
test/          # vitest suites
```

The Worker serves the GUI as a single HTML string, so you edit `src/gui/` and `npm run build:gui`
inlines it. `wrangler dev`, `deploy`, and `npm test` run that build automatically first.
The generated `src/gui.generated.html` is not committed — never edit it directly.

## License

[MIT](./LICENSE)
