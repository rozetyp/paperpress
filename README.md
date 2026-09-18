# paperpress

An API that detects a company's brand from its live URL — logo, primary color, font — and renders markdown into a PDF styled in that brand, in one HTTP call. Plain REST API plus a hosted MCP endpoint. MIT licensed.

## Try it right now

No signup, no key — hits the live instance's demo route (rate-limited, 30/hour/IP):

```bash
curl -X POST https://paperpress.up.railway.app/v1/demo \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com"}'
```

Returns the brand kit detected live from `stripe.com` plus a signed URL to a PDF rendered in it. Swap in any company's URL.

With your own markdown and an API key, the same shortcut is `brandFromUrl`:

```
POST /v1/documents
{ "markdown": "# Q4 report\n...", "brandFromUrl": "stripe.com" }
→ signed URL to a PDF in Stripe's brand
```

## How it works

A single Fastify process does three things:

1. **Detect** (`src/render/detect.ts`) — navigates the target URL with a pooled Playwright/Chromium instance, reads `theme-color`, brand CSS custom properties, CTA button colors, header `<img>` candidates, and computed font stacks.
2. **Render** (`src/render/`) — turns markdown into HTML (`unified`/`remark`/`rehype`), applies a theme + brand kit, prints to PDF with Playwright.
3. **Serve** — PDFs go to local disk (or a mounted volume) behind HMAC-signed, time-limited URLs.

No queue, no worker process. Renders are sync, typically 100–400ms once Chromium is warm; detection is cached 24h per host.

## What's here

```
.
├── src/                       Fastify API (single process)
│   ├── index.ts               Bootstrap, route registration
│   ├── env.ts                 Env validation (zod)
│   ├── lib/                   prisma, auth, billing, storage, email, url-fetch (SSRF guard), inline-image
│   ├── render/                markdown → HTML → PDF (themes/, detect.ts)
│   └── routes/                auth, documents, demo, account, pdf, brand-kits, admin, mcp
├── prisma/schema.prisma       5 models: User, ApiKey, Document, CreditTransaction, BrandKit
├── samples/                   Example output (see Examples below) + input markdown used to generate it
├── scripts/                   preview.ts / detect.ts — regenerate the samples/ output locally
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
No auth, no credits charged. Strict per-IP rate limit (30/hour) on top of the global 60/min.

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

### MCP
| Path | What it does |
|---|---|
| POST `/mcp` | Streamable HTTP MCP endpoint — one `generate_pdf` tool, same auth/credits as `/v1/documents`. Add `https://paperpress.up.railway.app/mcp` directly to your client's MCP config (Claude Desktop/Claude.ai connectors, Cursor's `mcp.json`, Claude Code). No install. |

## Security posture

- **API keys**: 192-bit random, stored as plaintext (so `/account` can show them); revocation uses a `revokedAt` timestamp with a grace window.
- **Signed URLs**: HMAC-SHA256, `exp` + `sig` query params, 7-day default TTL.
- **SSRF guard**: `assertPublicUrl` resolves DNS and rejects RFC1918, loopback, link-local, IPv6 ULA on the URL a caller submits. Applied to `brandKit.logoUrl` and `/v1/brand-kits/detect`. The submitted host being public doesn't guarantee every hop is — a public host can redirect to a private address — so both the Playwright navigation path (`src/render/detect.ts`) and the image-inlining fetch (`src/lib/inline-image.ts`) re-validate the address on every redirect hop before following it and again after final navigation. This narrows the window but doesn't fully eliminate it: the initial connection to a redirect target happens before the re-check can reject it, so a determined attacker can still cause a blind outbound request (no response data is returned to them) even though no page content is ever extracted or rendered from a rejected target. Full closure would need IP-pinning at the network layer.
- **CSS injection guard**: the `css` field rejects `<style>`, `</style>`, `<script>`, `</script>` — otherwise the raw embed inside `<style>${css}</style>` would let an attacker break out and run JS in the Chromium pool.
- **Markdown sanitization**: `remark-rehype` runs with `allowDangerousHtml: false`, so `<script>` in markdown bodies is stripped.
- **Limits**: markdown ≤ 500KB, css ≤ 50KB, body ≤ 2MB, render ≤ 30s, rendered pages ≤ `MAX_PAGES_PER_RENDER` (default 200), rate ≤ 60 req/min/key.
- **Admin endpoint**: constant-time token compare; routes return 404 (not 401) when token wrong or unset.
- **Known gap**: brand detection (`detect.ts`) has no bound on `page.evaluate()` (Playwright's API has no timeout for it) — a page that hangs after navigation can hold a pooled Chromium context forever. With `PLAYWRIGHT_MAX_CONTEXTS` at its default of 2, two such requests exhaust render capacity for everyone until restart. Not fixed; documented instead — see commit history if you want the failed attempts at fixing it.

## Local dev

```bash
cp .env.example .env   # set SIGNING_SECRET to `openssl rand -base64 32`
npm install
npx prisma migrate dev
npm run dev
```

```bash
# Register (dev: RESEND_API_KEY unset, key is logged to stdout instead of emailed)
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d '{"email":"you@example.com"}'

# Render
curl -X POST http://localhost:3000/v1/documents \
  -H "Authorization: Bearer pp_live_..." -H "Content-Type: application/json" \
  -d '{"markdown":"# Hello\n\nWorld.","title":"Test"}'
```

## Examples

Checked into [samples/](samples/) — generated by `scripts/preview.ts` and `scripts/detect.ts`, regenerate with `npx tsx scripts/preview.ts` / `npx tsx scripts/detect.ts <url>`.

**Same markdown, five themes** (`clean` shown — [full PDF](samples/preview-clean.pdf)):

![clean theme example](samples/preview-clean.png)

| Theme | PDF |
|---|---|
| `academic` | [preview-academic.pdf](samples/preview-academic.pdf) |
| `executive` | [preview-executive.pdf](samples/preview-executive.pdf) |
| `marketing` | [preview-marketing.pdf](samples/preview-marketing.pdf) |
| `technical` | [preview-technical.pdf](samples/preview-technical.pdf) |

**Brand auto-detected from a live URL** (`brandFromUrl: "stripe.com"` — [full PDF](samples/detect-stripe-com.pdf)):

![stripe brand-detected example](samples/detect-stripe-com.png)

| Source URL | Detected + rendered |
|---|---|
| github.com | [detect-github-com.pdf](samples/detect-github-com.pdf) |
| railway.com | [detect-railway-com.pdf](samples/detect-railway-com.pdf) |
| vercel.com | [detect-vercel-com.pdf](samples/detect-vercel-com.pdf) |

## License

MIT — see [LICENSE](LICENSE).
