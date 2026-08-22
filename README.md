# paperpress

An API that detects a company's brand from its live URL — logo, primary color, font — and renders markdown into a PDF styled in that brand, in one HTTP call. Ships as a plain REST API and as an MCP server.

```
POST /v1/documents
{ "markdown": "# Q4 report\n...", "brandFromUrl": "stripe.com" }
→ ~1s → signed URL to a PDF in Stripe's brand
```

## About this project

This was built and briefly run as a real deployed service before I looked closely at the market it would need to compete in: Claude ships native PDF/PPTX/DOCX generation now, and Brandfetch already sells a Brand Context API built specifically for grounding AI agents, with real paying customers. Both halves of what this does — detect a brand, render a document — are now commodity-adjacent or already owned by a funded competitor. I'm not pursuing this as a product.

It's public as a portfolio piece / reference implementation: a working Playwright-based brand detector (CSS custom properties, CTA color sampling, scored logo-candidate extraction, WCAG contrast guard), a sync Fastify render pipeline, an SSRF-hardened URL fetcher, and an MCP server wrapping it. Read the code, fork it, run it — it's MIT licensed. It is not maintained as a product: no payment processing is wired up, the MCP package (`mcp/`) is not published to npm, and there's no support commitment behind the live demo below.

## How it works

A single Fastify process does three things:

1. **Detect** (`src/render/detect.ts`) — navigates the target URL with a pooled Playwright/Chromium instance, reads `theme-color`, brand CSS custom properties, CTA button colors, header `<img>` candidates scored by position/size/format, and computed font stacks. Filters near-white/near-black/near-gray noise, applies a WCAG luminance guard so a too-light brand color doesn't blow out text contrast.
2. **Render** (`src/render/`) — turns markdown into HTML via `unified`/`remark`/`rehype` (with `allowDangerousHtml: false`), applies one of five themes plus the detected/supplied brand kit, and prints to PDF with Playwright.
3. **Serve** — PDFs go to local disk (or a mounted volume) behind HMAC-signed, time-limited URLs.

No queue, no worker process, no Redis. Renders are sync and typically 100–400ms once Chromium is warm; detection is cached 24h per host.

## Live demo

- API: <https://paperpress-production.up.railway.app>
- Docs: <https://paperpress-production.up.railway.app/docs/>
- Try the brand detector + a demo render straight from the landing page.

Single free-tier instance, kept up as a demo. No support guarantees, may come down.

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
├── mcp/                       MCP server (unpublished — see mcp/README.md)
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

Not a product, so these are disclosed rather than tracked as a backlog:

- **No automated test suite.** Everything above was verified by hand against a running instance; there's no regression net.
- **No committed Prisma migrations.** The container start command runs `prisma db push --skip-generate --accept-data-loss`.
- **In-memory rate limiting and detect-cache.** Fine single-instance; wouldn't survive multiple replicas without moving both to something shared.
- **No payment processing wired up.** The credit system exists in the schema and API; nothing charges a card.
- **The MCP package (`mcp/`) is not published to npm** and isn't going to be — see [mcp/README.md](mcp/README.md).

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

See [mcp/README.md](mcp/README.md). A thin MCP client over the REST API. Not published to npm — included as reference code, not as an installable tool.

## Deploy (Railway example)

The exact steps used for the live demo above — kept here as documentation of the real deployment, not as an invitation to run this in production.

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

## Status

**Built**: markdown → PDF across 5 themes, brand-kit auto-detect from a URL (real font-family stack, not just a `serif|sans|mono` bucket), 24h detect cache, `brandFromUrl` one-call shortcut, batch detect (20 URLs in parallel), WCAG luminance guard, email-based key issuance with rotation grace, an MCP server, a read-only admin surface, signed share URLs, pre-rendered docs.

**Not built, on purpose**: payment processing, npm publish of the MCP package, automated tests, real Prisma migrations. This isn't a live backlog — it's finished as a portfolio piece, not being developed toward a 1.0.

## License

MIT — see [LICENSE](LICENSE).
