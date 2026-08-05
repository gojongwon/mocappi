# <img src="./assets/logo.svg" height="30" alt="mocappi logo"> mocappi

A mock REST API you define entirely in the URL. No app to install, no config to commit, no redeploy — edit the query string and you're done. **The same URL always returns the same data.**

[한국어 문서 (Korean)](./README.ko.md)

**Live demo:** https://mocappi.gojongwon.workers.dev

- GUI (URL builder + live preview): `GET /`
- Data: `GET | POST | PUT | PATCH | DELETE /api/<resource>?field=type&...`
- Supported types: `GET /schema/types`
- Infer a schema from example JSON: `POST /schema/infer` (send an OpenAPI/Swagger document to import a spec)
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

Sort — `-` prefixes a descending key, comma-separates several:

```
/api/users?name=person.fullName&age=int:20~60&_sort=-age,name   # oldest first, ties by name
```

Neither `_q` nor `_sort` enters the seed — the *i*-th item is always the same item; only which
items come back, and in what order, changes. Both work within the **first 1,000 items** (CPU
budget), so with a larger `_total` the reported `total` is the count inside that window.
Empty values (`null`) always sort last, whichever direction you ask for.

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

## Relations between resources

`pk`/`ref` make foreign keys line up across resources — with no storage and no lookups.
Both sides derive the value from nothing but the resource name and the item index, so two URLs
that have never seen each other agree forever:

```
/api/users?id=pk:users&name=person.fullName                 # id: deterministic uuid per index
/api/orders?id=uuid&userId=ref:users&amount=int:1000~90000  # userId ∈ users' first 100 ids
```

Every `orders[i].userId` is exactly one of the `id` values in the `users` list. Adding or removing
other fields on either side never breaks the relation (a `pk` ignores the rest of its schema on
purpose). `ref:users:500` widens the pool to the first 500 — match it to the target's `_total`.
The single-item shapes compose as usual: `_wrap=one`, write methods, arrays (`viewers[]=ref:users:2`).

## Stateful presets

Write responses carry an `X-Mock-State` header — `applied` (reflected in state) or `stateless`
(shape-only mocking). Stateless writes answer 201 too, so tell them apart by this header, not the status.

A preset saved in a workspace (`_s=<ws>.<id>`) **remembers writes** — the TanStack Query style
"mutation → invalidate → refetch" flow actually works:

```bash
curl -X POST   '…/api/users?_s=aB3xK9.x1y2z3' -d '{"name":"Hong Gildong"}'  # 201 — created
curl           '…/api/users?_s=aB3xK9.x1y2z3'                               # first in the list, total +1
curl -X PATCH  '…/api/users/<id>?_s=aB3xK9.x1y2z3' -d '{"age":30}'          # that item changes
curl -X DELETE '…/api/users/<id>?_s=aB3xK9.x1y2z3'                          # 204 — gone from the list
```

- POST returns a complete item: schema defaults plus the body you sent. Editing or deleting a
  missing id answers 404 — like a real API.
- Updates and deletes target the id in the last path segment (matched against the schema's
  top-level `id` field). Created items get an id injected even when the schema has no `id` field.
- State is scoped to the workspace — the same "whoever has the link" model as saved presets.
  It merges into search (`_q`), sort (`_sort`) and NDJSON/CSV responses too (the same first-1,000 window).
- Lifetime: 24 hours from the last write. Inspect via `GET /schema/state/<sid>`, reset via
  `DELETE /schema/state/<sid>`. Caps: 50 creates · 100 updates · 200 deletes (exceeding answers 400 with a reset hint).
- GUI: load a preset and pick a write method — a **state panel** appears under the URL;
  send a body and on success it switches to the GET list so the change is right there.
- **The determinism boundary**: unsaved URLs and public-pool presets stay fully stateless.
  A body-less POST (the GUI preview is one) and `_method=` links never change state —
  state changes only through real verbs carrying a JSON body.

## Failure responses

`_status` at 400 or above replaces the data with a failure body:

```
/api/users?name=person.fullName&_status=404
→ 404 { "error": "Not Found", "status": 404, "message": "The request could not be processed." }
```

`error` is the standard reason phrase for **every** standard 4xx/5xx code (`413` → `Payload Too Large`,
`451` → `Unavailable For Legal Reasons`, …); non-standard codes fall back to `Error`.
`message` is one sentence per class — 4xx "could not be processed", 5xx "server encountered an error".

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
| `_sort` | — | Sort (comma-separated, `-` for descending, dot paths): `_sort=name,-age` (within the first 1,000 items) |
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

**The v1.0 promise.** Determinism is now a semantic-versioning commitment:

- Within 1.x the seed rules never change — what enters the seed (`_locale`, `_total`, `_seed`,
  the field definitions) and how it is derived stay as they are, so a URL you saved keeps
  returning the same bytes across every 1.x deploy.
- Anything that would alter generated values — including a faker upgrade — only lands in a major
  version. That is why faker is pinned to an exact version (`10.5.0`) in `package.json`.
  For snapshot tests, pinning mocappi to a major is enough.

**Caching:** because the same URL is the same bytes, successful responses ship
`Cache-Control: public, max-age=300` and are cached at the edge for 5 minutes (check
`Cf-Cache-Status: HIT`). The data is identical either way, so the only difference is speed.
Three things are never cached: requests with `_delay` (the delay is the point), `_status>=400`
failures, and workspace-preset (`_s=<ws>.<id>`) responses — they may carry state (see Stateful presets). Deleting a saved preset (`_s=`) may keep serving the old response for up to 5 minutes.

## `X-Total-Count`

Every list response carries the total count as a header, so it survives shapes that have no
envelope to put it in — `_wrap=none`, `_format=ndjson`, `_format=csv`. It is the same number the
envelope's `total` reports (with `_q`/`_sort`, the window count). `Access-Control-Expose-Headers`
already ships with it, so browser JS can read it cross-origin without extra setup:

```js
const res = await fetch('https://…/api/users?name=person.fullName&_wrap=none');
const total = Number(res.headers.get('X-Total-Count'));   // 100
```

That's the contract table libraries like json-server clients, react-admin and refine expect.
Responses that aren't lists don't carry it: `_wrap=one`, write methods (POST/PUT/PATCH),
`DELETE` (204), and `_status>=400` failures.

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

Open the preset dropdown and every entry has a ✕ on the right (one confirmation step). Editing cannot happen in place (the ID is a hash of the content) — save the edited schema as a new preset and delete the old one with ✕.

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

## Export

The **Export** menu next to the URL copies the current schema in five shapes.

| Item | What you get |
|---|---|
| `curl` | `curl -X POST 'https://…'` — paste and run |
| `fetch (JS)` | `await fetch(url)` + `res.json()` |
| `Python requests` | `requests.get(url).json()` |
| `TS types` | see below |
| `OpenAPI` | see below |

**Call snippets differ from copying the URL.** The URL is method-neutral (the GUI sends the real
verb, not `_method`), so picking POST is not reproducible from the URL alone — the snippet carries
`-X POST`. `DELETE` returns 204 with no body, so its snippet prints the status instead of parsing one.

## TypeScript types

**Export → TS types** (or `GET /schema/ts?<schema>&_res=<resource>`) generates an interface for the current schema, a generic `Paginated<T>` envelope, and a `fetchMock<T>` helper. `enum:a|b|c` becomes the literal union `'a' | 'b' | 'c'`.

```ts
const res = await fetchMock<User>(url);
res.data[0].name; // autocompleted & type-checked
```

## OpenAPI

Not using TypeScript? **Export → OpenAPI** (or `GET /schema/openapi?<schema>&_res=<resource>`)
exports the same schema as an OpenAPI 3.1 document — import it into Postman/Insomnia, or feed it to
`openapi-generator` for a client in any language.

```bash
curl 'https://mocappi.gojongwon.workers.dev/schema/openapi?_res=users&id=uuid&name=person.fullName&_total=500' > users.json
```

- Each field parameter's `default` is the DSL that produced the document, so the import calls a working URL right away.
- `enum:paid*8|refund*2` → `enum: [paid, refund]` (weights are probabilities, not values);
  `internet.email?0.2` → `type: [string, null]` (the 3.1 way, not `nullable: true`).
- Every field carries a real generated value in `examples`, in the request's `_locale`.
- Pass `_method` and the operation is emitted under that verb (POST → 201 single item, DELETE → 204).

### OpenAPI import (the reverse direction)

Export's opposite works too — paste an OpenAPI (Swagger) document your team already has into the
GUI's **Paste JSON** dialog (or send it to `POST /schema/infer`) and the response schema definition
fills in the fields, the types, and the resource name. The fastest path from a spec document to a
working mock API.

```bash
curl -X POST https://mocappi.gojongwon.workers.dev/schema/infer \
  -H 'content-type: application/json' --data @openapi.json
```

- Accepts OpenAPI 3.x and Swagger 2.0. Resolves in-document `$ref`, `allOf`, `oneOf/anyOf`;
  nullable (3.0 `nullable` / 3.1 `type: [..., null]`) becomes `?0.2`
- `format` mapping: `uuid` → `uuid`, `email` → `internet.email`, `date-time` → `date:…`,
  `uri` → `internet.url`, and so on. `enum`, `const`, `minimum/maximum` and `maxLength` are read too
- With several operations in the document it picks the most list-like GET 200 and tells you the
  rest were ignored — paste a document with just the path you want to import that one
- Fields the v1 DSL cannot express (arrays of objects, …) come back in `skipped` with a reason

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
