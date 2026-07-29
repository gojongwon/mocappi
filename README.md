# <img src="./assets/logo.svg" height="30" alt="Mock API logo"> Mock API

A mock REST API you define entirely in the URL. No app to install, no config to commit, no redeploy — edit the query string and you're done. **The same URL always returns the same data.**

[한국어 문서 (Korean)](./README.ko.md)

**Live demo:** https://mock-api.gojongwon.workers.dev

- GUI (URL builder + live preview): `GET /`
- Data: `GET /api/<resource>?field=type&...`
- Supported types: `GET /schema/types`
- Infer a schema from example JSON: `POST /schema/infer`
- Generate TypeScript types: `GET /schema/ts` (or the "TS 타입 복사" button in the GUI)

## Quick start

**Use it:** open the deployed worker URL — the GUI loads. Click a preset, or paste a real API response into **JSON paste** and a schema is inferred automatically. Copy the URL and `fetch` it.

**Deploy your own:**

```bash
git clone https://github.com/gojongwon/mock-api.git && cd mock-api
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

Loading and error-state testing:

```
/api/products?name=commerce.productName&_delay=3000     # 3s delay
/api/orders?id=uuid&_status=500                          # forced status code
```

## Reserved parameters (prefix `_`)

| Param | Default | Description |
|---|---|---|
| `_page` | 1 | Page number (1-based) |
| `_limit` | 10 | Items per page (max 100) |
| `_total` | 100 | Virtual total count |
| `_seed` | URL hash | Explicit seed |
| `_locale` | ko | `ko` \| `en` |
| `_delay` | 0 | Response delay in ms (max 5000) |
| `_status` | 200 | Forced HTTP status code |
| `_wrap` | envelope | `envelope` \| `none` (bare array) |
| `_s` | — | Saved schema ID (see Workspaces) |

Anything not starting with `_` is a field definition.

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
address.city=location.city    # dot notation → nested object
tags[]=lorem.word:3           # array — trailing :N is length (default 3)
```

Full list at `GET /schema/types`. Invalid DSL returns a 400 that explains what's wrong and how to fix it.

## Determinism

- The same URL always returns byte-identical responses.
- Per-item seeding: the global *i*-th item is stable even when `_page`/`_limit` change.
- Field order, `_delay`, and `_status` don't affect the data.
- faker `date.*` uses a pinned refDate so values don't drift over time.

Note: upgrading the faker library may change generated values — pin the version while using snapshots.

## Workspaces (multi-team / public use)

Storage is isolated by **workspace** — a capability-URL model with no login:

- **Saving requires a workspace** — the public pool is read-only. Header storage button → "새 워크스페이스 만들기" → share the link (`/?_ws=<ID>`) with your team. You can also paste a received ID/link in the same modal to switch.
- Only people who know the link see that workspace's preset list.
- Short URLs: `?_s=<ws>.<id>` (public pool: `?_s=<id>`).
- Limits: 100 saved schemas per workspace; workspace entries expire after 180 days of no re-save (public pool is permanent).

Saved schemas are **content-addressed and immutable**: the ID is a hash of the content, so a shared `_s=` URL returns the same data forever. Editing and re-saving produces a new ID.

### Enable team storage (once)

```bash
npx wrangler kv namespace create SCHEMAS
# paste the printed id into [[kv_namespaces]] in wrangler.toml
npm run deploy
```

Without the KV binding everything else works; only the save UI is disabled.

### Operating publicly

- Add a rate limiting rule for `/schema/save` (Cloudflare dashboard → Security → WAF).
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
  gui.html     # single-file GUI
test/          # vitest suites
```

## License

[MIT](./LICENSE)
