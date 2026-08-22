# paperpress

Self-hostable API that detects a company's brand from its live URL — logo, primary color, font — and renders markdown into a PDF styled in that brand, in one HTTP call. Ships as a plain REST API and as an MCP server, so it's usable from any agent framework, not just one chat product.

```
POST /v1/documents
{ "markdown": "# Q4 report\n...", "brandFromUrl": "stripe.com" }
→ ~1s → signed URL to a PDF in Stripe's brand
```

## Who this is for

- **Developers building agents or automations** (LangChain, custom agent loops, n8n/Make, or anything that can make an HTTP call) that need to hand a user a professional-looking, on-brand document — proposals, reports, one-pagers — without hand-rolling a renderer or paying for a hosted brand-data API.
- **People running local/self-hosted MCP tooling** (Claude Code, Cursor, other MCP clients) who want something they can install, read, and self-host rather than depend on a closed SaaS.
- **Anyone who wants a reference implementation** of "visit a live page with a real browser, extract its brand signals, apply them to a render" — the detector (`src/render/detect.ts`) is useful reading on its own.

### What this is not

- Not a brand-data platform with a curated database (that's [Brandfetch](https://brandfetch.com) — paid, much larger company/logo coverage, an agent-context API of its own).
- Not a template/WYSIWYG document builder (see CraftMyPDF, PDFGenerator API if you need that).
- Not e-signature or legal-grade document infra (see DocuSign, Anvil).
- Not a managed service with an SLA — the hosted instance below is a reference deployment, not a commercial product. Self-hosting is the intended primary use.

## How it works

A single Fastify process does three things:

1. **Detect** (`src/render/detect.ts`) — navigates the target URL with a pooled Playwright/Chromium instance, reads `theme-color`, brand CSS custom properties, CTA button colors, header `<img>` candidates scored by position/size/format, and computed font stacks. Filters near-white/near-black/near-gray noise, applies a WCAG luminance guard so a too-light brand color doesn't blow out text contrast.
2. **Render** (`src/render/`) — turns markdown into HTML via `unified`/`remark`/`rehype` (with `allowDangerousHtml: false`), applies one of five themes plus the detected/supplied brand kit, and prints to PDF with Playwright.
3. **Serve** — PDFs go to local disk (or a mounted volume) behind HMAC-signed, time-limited URLs.

No queue, no worker process, no Redis. Renders are sync and typically 100–400ms once Chromium is warm; detection is cached 24h per host.

## Live reference deployment

- API: <https://paperpress-production.up.railway.app>
- Docs: <https://paperpress-production.up.railway.app/docs/>
- Try the brand detector + a live demo render straight from the landing page.

This is a single free-tier-ish reference instance, not a product with support guarantees. If you want reliability, self-host — see below.

## What's here

```
.
├── src/                       Fastify API (single process)
│   ├── index.ts               Bootstrap, route registration, static handler
│   ├── env.ts                 Env validation (zod)
│   ├── lib/                   prisma, auth, billing, storage, email, url-fetch (SSRF guard), inline-image
│   ├── render/                markdown → HTML → PDF (themes/, detect.ts)
│   └── routes/                auth, documents, demo, account, pdf, brand-kits, admin
├── prisma/schema.prisma       5 models: User, ApiKey, Document, CreditTransaction, BrandKit
├── mcp/                       MCP server (separate npm package @paperpress/mcp)
├── landing/                   Static landing + pre-rendered /docs/*.html
├── docs/                      Markdown source for the docs pages
├── scripts/                   build-docs.ts (docs prerender), preview.ts / detect.ts (local sample generation)
├── Dockerfile                 Single-image deploy (Playwright base)
└── railway.json               Railway config (healthcheck only — start cmd is in Dockerfile)
```

## API surface (v1)

### Auth
| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/auth/register` | - | Request a key by email. Always 202; key is sent to the inbox. First time = new user + free credits. Subsequent calls = rotate (old keys valid 24h, then revoked). |

### Render
| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/v1/documents` | Bearer key | Markdown → PDF. Accepts `theme`, `brandKit` (saved name or inline), `brandFromUrl` (detect-and-apply shortcut), `css`, `format`, `landscape`, `title`. Returns signed URL. 413 if rendered pages > `MAX_PAGES_PER_RENDER` (default 200). |
| GET | `/pdf/:id?exp=&sig=` | signed URL | Stream the PDF |

### Brand kits
| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/v1/brand-kits` | Bearer key | Create/update a saved kit by name (one per user per name) |
| GET | `/v1/brand-kits` | Bearer key | List your kits |
| GET | `/v1/brand-kits/:id` | Bearer key | Read one kit |
| DELETE | `/v1/brand-kits/:id` | Bearer key | Delete a kit |
| POST | `/v1/brand-kits/detect` | Bearer key | Pass a URL, get back `primaryColor`, `logoUrl`, `favicon`, `fontFamily`, `fontStyle`. 24h-cached. Pass `{ refresh: true }` to bypass. |
| POST | `/v1/brand-kits/detect-batch` | Bearer key | Up to 20 URLs in parallel through the existing Playwright pool. Per-item errors return inline. |

### Account / health
| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/account` | Bearer key | Email, credits, list of active API keys (plaintext, so users can recover) |
| GET | `/health` | - | `{ status: 'ok' }` |

### Demo (anonymous, gated)
Powers the "Try it" widget on the landing page. No auth, no credits charged. Strict per-IP rate limit (30/hour) on top of the global 60/min.

| Method | Path | What it does |
|---|---|---|
| POST | `/v1/demo` | `{ url }` → detect brand (cached) + render the bundled `samples/demo-q4-review.md` as PDF. Returns kit + signed URL. |

### Admin (read-only)
Gated by `X-Admin-Token` header. When `ADMIN_TOKEN` is unset, every `/admin/*` route returns 404 — no surface, no discovery.

| Method | Path | What it does |
|---|---|---|
| GET | `/admin/stats` | Totals: users, active keys, docs, pages, bytes, credits, doc counts for last 24h / 7d |
| GET | `/admin/users` | Paginated list with per-user doc and key counts |
| GET | `/admin/documents` | Paginated list with user email joined. Filter by `userId`, `status`. |
| GET | `/admin/documents/:id/pdf` | Stream any PDF without a signed URL |

## Security posture

- **API keys**: 192-bit random, stored as plaintext (so `/account` can show them); revocation uses a `revokedAt` timestamp with a grace window.
- **Signed URLs**: HMAC-SHA256, `exp` + `sig` query params, 7-day default TTL.
- **SSRF guard**: `assertPublicUrl` resolves DNS and rejects RFC1918, loopback, link-local, IPv6 ULA on the URL a caller submits. Applied to `brandKit.logoUrl` and `/v1/brand-kits/detect`. The submitted host being public doesn't guarantee every hop is — a public host can redirect to a private address — so both the Playwright navigation path (`src/render/detect.ts`) and the image-inlining fetch (`src/lib/inline-image.ts`) re-validate the address on every redirect hop before following it and again after final navigation. This narrows the window but doesn't fully eliminate it: the initial connection to a redirect target happens before the re-check can reject it, so a determined attacker can still cause a blind outbound request (no response data is returned to them) even though no page content is ever extracted or rendered from a rejected target. Full closure would need IP-pinning at the network layer.
- **CSS injection guard**: the `css` field rejects `<style>`, `</style>`, `<script>`, `</script>` — otherwise the raw embed inside `<style>${css}</style>` would let an attacker break out and run JS in the Chromium pool.
- **Markdown sanitization**: `remark-rehype` runs with `allowDangerousHtml: false`, so `<script>` in markdown bodies is stripped.
- **Limits**: markdown ≤ 500KB, css ≤ 50KB, body ≤ 2MB, render ≤ 30s, rendered pages ≤ `MAX_PAGES_PER_RENDER` (default 200), rate ≤ 60 req/min/key.
- **Admin endpoint**: constant-time token compare; routes return 404 (not 401) when token wrong or unset.

## Known limitations

- **No automated test suite yet.** Everything above has been verified by hand against a running instance; there's no regression net if you change this code. Contributions adding tests (especially around the SSRF guard and the render pipeline) are very welcome.
- **No committed Prisma migrations.** The container start command runs `prisma db push --skip-generate --accept-data-loss`. Fine for a demo instance; generate real migrations (`npx prisma migrate dev --name init`) before trusting this with data you can't afford to lose.
- **In-memory rate limiting and detect-cache.** Fine single-instance; if you scale to multiple replicas, move both to something shared (Redis, or a Postgres row with a TTL).
- **The MCP package (`mcp/`) is not yet published to npm.** `npx @paperpress/mcp` in the MCP docs won't resolve until someone runs `npm publish ./mcp --access public`.

## Local dev

```bash
# 1. Postgres running locally on 5432
# 2. Env
cp .env.example .env
# (set SIGNING_SECRET to `openssl rand -base64 32`)

# 3. Install + migrate
npm install
npx prisma migrate dev

# 4. Run
npm run dev
```

Smoke test:

```bash
# Request a key. Response is { "sent": true } - the key arrives by email.
# In dev (RESEND_API_KEY unset) the server logs the email to stdout; grab the
# key from there.
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'

export PP_KEY="pp_live_..."

# Render
curl -X POST http://localhost:3000/v1/documents \
  -H "Authorization: Bearer $PP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Hello\n\nWorld.","title":"Test"}'
```

## MCP

See [mcp/README.md](mcp/README.md). The MCP server is a thin client over the REST API — same auth, same billing — so it works against either the hosted reference instance or your own self-hosted one.

## Deploy it yourself (Railway example)

These are the exact steps used for the reference deployment above; adapt the service name/domain for your own.

```bash
# 1. Create project with a Postgres database
railway init --name paperpress
railway add --database postgres

# 2. Create the app service. DATABASE_URL is wired via service reference.
railway add --service paperpress \
  --variables "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --variables "SIGNING_SECRET=$(openssl rand -base64 32)" \
  --variables "PUBLIC_BASE_URL=https://your-app.up.railway.app" \
  --variables "STORAGE_DIR=/data/storage" \
  --variables "NODE_ENV=production" \
  --variables "FREE_TIER_CREDITS=100" \
  --variables "PLAYWRIGHT_MAX_CONTEXTS=2" \
  --variables "RENDER_TIMEOUT_MS=30000" \
  --variables "KEY_GRACE_PERIOD_HOURS=24" \
  --variables "MAX_PAGES_PER_RENDER=200" \
  --variables "ADMIN_TOKEN=$(openssl rand -base64 36 | tr -d '\n')"

# 3. Attach a volume so PDFs survive container restarts
railway service paperpress
railway volume add --mount-path /data/storage

# 4. Domain (auto-detects the container port)
railway domain --port 3000

# 5. Ship
railway up --detach -c
```

Notes:
- The Dockerfile uses `mcr.microsoft.com/playwright:vX.Y-jammy` as the base. Keep that version in lockstep with the `playwright` npm package — a mismatch means the browser binary won't exist and renders fail.
- The `startCommand` in `railway.json` is intentionally absent: Railway parses it as argv (not shell), so chained `&&` commands fail. The `CMD` in `Dockerfile` wraps in `sh -c` and runs the full start sequence.
- Emails: until `RESEND_API_KEY` is set, registration keys are logged to stdout. Grep for `[email:console]`.

## Docs

Product docs live in [docs/index.md](docs/index.md) and pre-render to `landing/docs/*.html` at Docker build time (`scripts/build-docs.ts`).

## Roadmap

**Shipped**: markdown → PDF across 5 themes, brand-kit auto-detect from a URL (real font-family stack, not just a `serif|sans|mono` bucket), 24h detect cache, `brandFromUrl` one-call shortcut, batch detect (20 URLs in parallel), WCAG luminance guard, email-based key issuance with rotation grace, MCP server, read-only admin surface, signed share URLs, pre-rendered docs.

**Good first issues / contributions welcome**:
- Automated tests (unit tests for the detector's color/font parsing, integration tests for the render pipeline, a redirect-based SSRF regression test)
- Real Prisma migrations in place of `db push`
- Publish `@paperpress/mcp` to npm
- Open/view tracking on `/pdf/:id` (the route is already fully owned — just needs a `DocumentView` table and a read endpoint)
- Per-render preview thumbnail, watermarks, cover pages

**Explicitly not planned**: template variable interpolation (agents can do this client-side), a drag-drop template editor, PDF merge/split, e-signature — all better served by existing dedicated tools.

## License

MIT — see [LICENSE](LICENSE).
