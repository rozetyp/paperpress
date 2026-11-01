# paperpress

An API that detects a company's brand from its live URL - logo, primary color, font - and renders markdown into a PDF styled in that brand, in one HTTP call. Plain REST API plus a hosted MCP endpoint. No signup, no API key: every endpoint is open and rate-limited per IP.

## Try it right now

Hits the live instance's demo route (rate-limited, 30/hour/IP):

```bash
curl -X POST https://paperpress.up.railway.app/v1/demo \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com"}'
```

Returns the brand kit detected live from `stripe.com` (primary color, logo, real font stack) plus a signed URL to a PDF rendered in it, generated at the moment you ran that command. Swap in any company's URL.

With your own markdown, the same shortcut is `brandFromUrl`:

```bash
curl -X POST https://paperpress.up.railway.app/v1/documents \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Q4 report\n\nRevenue up 14%.","brandFromUrl":"https://stripe.com"}'
```

Or from any MCP client, add the server by URL - nothing else to configure:

```json
{ "url": "https://paperpress.up.railway.app/mcp" }
```

## What's actually different here

Two concrete things, out of everything else in this repo:

1. **The detector reads live browser state, not a database.** Brandfetch - the funded, customer-backed competitor doing brand data for AI agents - works off a curated, crawled database: it has to have seen a company before, and coverage/freshness is the product. This navigates the real page with Playwright and reads `getComputedStyle`, actual CSS custom properties, and rendered CTA colors at request time, on any URL, including ones nobody's indexed yet. It also returns the exact font stack (e.g. `"sohne-var, SF Pro Display"`), not a coarse `serif`/`sans`/`mono` bucket, because it's reading what the browser renders, not classifying against a lookup table.
2. **Detect + render is one atomic call.** Everywhere else, you glue two vendors together yourself: call a brand-data API, get JSON back, then separately call an HTML/PDF-render API with that JSON - two round trips, two bills, integration code in between. `brandFromUrl` does both inside one HTTP call, synchronously, in about a second.

Neither makes the underlying idea a good business on its own - see below - but they're the two decisions here that aren't just "another wrapper."

**Known, honest gap in the same detector**: it reads the DOM at `domcontentloaded`, so it works well on server-rendered marketing pages but misses brand signals on pages that render their real UI client-side after that (`open.spotify.com`, for example - it gets the logo, misses the color). Several fixes were tried and reverted rather than shipped half-working; see commit history if you want the detail. Documented as a limitation, not silently papered over.

## About this project

This was built and briefly run as a real deployed service before I looked closely at the market it would need to compete in: Claude ships native PDF/PPTX/DOCX generation now, and Brandfetch already sells a Brand Context API built specifically for grounding AI agents, with real paying customers. Both halves of what this does - detect a brand, render a document - are now commodity-adjacent or already owned by a funded competitor. I'm not pursuing this as a product.

It's public as a portfolio piece / reference implementation: a working Playwright-based brand detector (CSS custom properties, CTA color sampling, scored logo-candidate extraction, WCAG contrast guard), a sync Fastify render pipeline, an SSRF-hardened URL fetcher, and a hosted MCP endpoint. Read the code, fork it, run it - it's MIT licensed. It is not maintained as a product.

## How it works

A single Fastify process does three things:

1. **Detect** (`src/render/detect.ts`) - navigates the target URL with a pooled Playwright/Chromium instance, reads `theme-color`, brand CSS custom properties, CTA button colors, header `<img>` candidates scored by position/size/format, and computed font stacks. Filters near-white/near-black/near-gray noise, applies a WCAG luminance guard so a too-light brand color doesn't blow out text contrast.
2. **Render** (`src/render/`) - turns markdown into HTML via `unified`/`remark`/`rehype` (with `allowDangerousHtml: false`), applies one of five themes plus the detected/supplied brand kit, and prints to PDF with Playwright.
3. **Serve** - PDFs go to local disk (or a mounted volume) behind HMAC-signed, time-limited URLs.

No queue, no worker process, no Redis, no database. Renders are sync and typically 100–400ms once Chromium is warm; detection is cached 24h per host.

## What's here

```
.
├── src/                       Fastify API (single process)
│   ├── index.ts               Bootstrap, route registration
│   ├── env.ts                 Env validation (zod)
│   ├── lib/                   storage (signed URLs), render-limit (per-IP budget), url-fetch (SSRF guard), inline-image
│   ├── render/                markdown → HTML → PDF (document.ts, themes/, detect.ts)
│   └── routes/                documents, detect, demo, pdf, mcp
├── samples/                   Example output (see Examples below) + input markdown used to generate it
├── scripts/                   preview.ts / detect.ts - regenerate the samples/ output locally
├── Dockerfile                 Single-image deploy (Playwright base)
└── railway.json               Railway config (healthcheck only - start cmd is in Dockerfile)
```

## API surface (v1)

All endpoints are anonymous. Limits are per IP.

| Method | Path | Limit | What it does |
|---|---|---|---|
| POST | `/v1/documents` | 30 renders/hour (shared with MCP) | Markdown → PDF. Accepts `theme`, `brandKit` (inline object), `brandFromUrl` (detect-and-apply shortcut), `css`, `format`, `landscape`, `title`. Returns a signed URL. 413 if rendered pages > `MAX_PAGES_PER_RENDER` (default 200). |
| POST | `/v1/detect` | 30/hour | Pass a URL, get back `primaryColor`, `logoUrl`, `favicon`, `fontFamily`, `fontStyle`. 24h-cached. Pass `{ refresh: true }` to bypass. |
| POST | `/v1/demo` | 30/hour | `{ url }` → detect brand (cached) + render a bundled sample report as PDF. Returns kit + signed URL. |
| GET | `/pdf/:id?exp=&sig=` | - | Stream the PDF (signed URL, 7-day TTL) |
| POST | `/mcp` | 30 renders/hour (shared with `/v1/documents`) | Streamable HTTP MCP endpoint - one `generate_pdf` tool, same inputs as `/v1/documents`. |
| GET | `/health` | - | `{ status: 'ok' }` |

Plus a global 60 requests/minute on everything.

**MCP**: standard Streamable HTTP transport, not tied to any one vendor's client or model: works with Claude Desktop, Claude.ai connectors, Cursor, Claude Code, and any other MCP-compatible client, local-model-based agents included. Add it by URL, no key, no install, no npm package - see `src/routes/mcp.ts`. Verified directly against the raw `@modelcontextprotocol/sdk` client; the server has no idea what model is on the other end.

## Security posture

- **No accounts**: there's nothing to steal - no keys, no emails, no database. The trade-off is that the Chromium pool is open to anyone, so it's guarded by per-IP limits (a shared hourly render budget for `/v1/documents` + MCP, 30/hour on detect and demo, 60/min globally) and a hard per-page timeout (below).
- **Signed URLs**: HMAC-SHA256, `exp` + `sig` query params, 7-day default TTL.
- **SSRF guard**: `assertPublicUrl` resolves DNS and rejects RFC1918, loopback, link-local, IPv6 ULA on the URL a caller submits. Applied to `brandKit.logoUrl`, `brandFromUrl`, `/v1/detect` and `/v1/demo`. The submitted host being public doesn't guarantee every hop is - a public host can redirect to a private address - so both the Playwright navigation path (`src/render/detect.ts`) and the image-inlining fetch (`src/lib/inline-image.ts`) re-validate the address on every redirect hop before following it and again after final navigation. This narrows the window but doesn't fully eliminate it: the initial connection to a redirect target happens before the re-check can reject it, so a determined attacker can still cause a blind outbound request (no response data is returned to them) even though no page content is ever extracted or rendered from a rejected target. Full closure would need IP-pinning at the network layer.
- **CSS injection guard**: the `css` field rejects `<style>`, `</style>`, `<script>`, `</script>` - otherwise the raw embed inside `<style>${css}</style>` would let an attacker break out and run JS in the Chromium pool.
- **Markdown sanitization**: `remark-rehype` runs with `allowDangerousHtml: false`, so `<script>` in markdown bodies is stripped.
- **Hung pages**: Playwright's `page.evaluate()` has no timeout, and some sites never settle (`airbnb.com` hung 60s+). Every browser page is raced against `RENDER_TIMEOUT_MS`; on timeout its context is killed and replaced, so a hung page can't hold a pool slot.
- **Limits**: markdown ≤ 500KB, css ≤ 50KB, body ≤ 2MB, render ≤ 30s, rendered pages ≤ `MAX_PAGES_PER_RENDER` (default 200).

## Known limitations

Not a product, so these are disclosed rather than tracked as a backlog:

- **No automated test suite.** Everything above was verified by hand against a running instance; there's no regression net.
- **In-memory rate limiting and detect-cache.** Fine single-instance; reset on restart and wouldn't hold across multiple replicas without moving both to something shared.
- **PDFs are never deleted.** Signed URLs expire after 7 days, but the files stay on the volume.

## Local dev

```bash
cp .env.example .env
# (set SIGNING_SECRET to `openssl rand -base64 32`)
npm install
npm run dev
```

Smoke test:

```bash
curl -X POST http://localhost:3000/v1/documents \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Hello\n\nWorld.","title":"Test"}'
```

## Deploy (Railway example)

The exact steps used for the real deployment this was run under - kept here as documentation, not as an invitation to run this in production.

```bash
# 1. Create the project
railway init --name paperpress

# 2. Create the app service
railway add --service paperpress \
  --variables "SIGNING_SECRET=$(openssl rand -base64 32)" \
  --variables "PUBLIC_BASE_URL=https://your-app.up.railway.app" \
  --variables "STORAGE_DIR=/data/storage" \
  --variables "NODE_ENV=production" \
  --variables "PLAYWRIGHT_MAX_CONTEXTS=2" \
  --variables "RENDER_TIMEOUT_MS=30000" \
  --variables "RENDERS_PER_HOUR=30" \
  --variables "MAX_PAGES_PER_RENDER=200"

# 3. Attach a volume so PDFs survive container restarts
railway service paperpress
railway volume add --mount-path /data/storage

# 4. Domain (auto-detects the container port)
railway domain --port 3000

# 5. Ship
railway up --detach -c
```

Notes:
- The Dockerfile uses `mcr.microsoft.com/playwright:vX.Y-jammy` as the base. Keep that version in lockstep with the `playwright` npm package - a mismatch means the browser binary won't exist and renders fail.
- The start command lives in the `Dockerfile` `CMD`, not `railway.json`.

## Examples

All of these are checked into [samples/](samples/) - generated by `scripts/preview.ts` and `scripts/detect.ts`, regenerate them yourself with `npx tsx scripts/preview.ts` / `npx tsx scripts/detect.ts <url>`.

**Same markdown, five themes** (`clean` shown below - [full PDF](samples/preview-clean.pdf)):

![clean theme example](samples/preview-clean.png)

| Theme | PDF |
|---|---|
| `academic` | [preview-academic.pdf](samples/preview-academic.pdf) |
| `executive` | [preview-executive.pdf](samples/preview-executive.pdf) |
| `marketing` | [preview-marketing.pdf](samples/preview-marketing.pdf) |
| `technical` | [preview-technical.pdf](samples/preview-technical.pdf) |

**Brand auto-detected from a live URL** (`brandFromUrl: "stripe.com"` - [full PDF](samples/detect-stripe-com.pdf)):

![stripe brand-detected example](samples/detect-stripe-com.png)

| Source URL | Detected + rendered |
|---|---|
| github.com | [detect-github-com.pdf](samples/detect-github-com.pdf) |
| railway.com | [detect-railway-com.pdf](samples/detect-railway-com.pdf) |
| vercel.com | [detect-vercel-com.pdf](samples/detect-vercel-com.pdf) |

**Inline brand kits** (no URL, fields passed directly in the request) - [forest](samples/preview-kit-forest.pdf), [mono-coral](samples/preview-kit-mono-coral.pdf), [stripe-colors](samples/preview-kit-stripe.pdf).

**Input markdown** used above: [sample.md](samples/sample.md), [demo-q4-review.md](samples/demo-q4-review.md) (the one used by `/v1/demo`).

## Status

**Built**: markdown → PDF across 5 themes, brand-kit auto-detect from a URL (real font-family stack, not just a `serif|sans|mono` bucket), 24h detect cache, `brandFromUrl` one-call shortcut, WCAG luminance guard, a hosted Streamable HTTP MCP endpoint, signed share URLs, per-IP render budget, hard per-page timeout.

**Removed, on purpose** (v0.2.0): accounts, API keys, credits, email key delivery, saved brand kits, batch detect, the admin dashboard, and Postgres. Nobody could get a key in practice (email delivery was never configured on the live deploy), so they were cost and friction with no upside.

**Not built, on purpose**: payment processing, automated tests. This isn't a live backlog - it's finished as a portfolio piece, not being developed toward a 1.0.

## License

MIT - see [LICENSE](LICENSE).
