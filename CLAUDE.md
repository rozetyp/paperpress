# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An API that detects a company's brand (logo, color, font) from its live URL and renders markdown into a PDF styled in that brand, in one HTTP call. A single Fastify process (`src/`) plus a separate, unpublished MCP client package (`mcp/`) that's a thin wrapper over the REST API — same auth, same request shape.

This is a portfolio piece, not an actively maintained product: no payment processing is wired up (the credit system is a Postgres counter with no charge path), `mcp/` is not published to npm, there's no automated test suite, and there are no committed Prisma migrations (see Known gaps below). Don't add features toward a 1.0 unless explicitly asked — bug fixes and code-quality work are the useful contributions here.

## Commands

```bash
npm run dev              # tsx watch src/index.ts — local dev server
npm run build             # tsc -> dist/
npm start                 # node dist/index.js (run build first)
npm run prisma:migrate    # prisma migrate dev (local schema changes)
npx tsc --noEmit          # typecheck only, no test suite exists — use this to verify changes
```

There is no test command — don't invent one; `npx tsc --noEmit` plus manual verification (see samples below) is the actual verification loop this repo uses.

Regenerating the example renders in `samples/` (useful after touching `src/render/`):
```bash
npx tsx scripts/preview.ts              # renders samples/sample.md across all 5 themes + a few brand kits
npx tsx scripts/detect.ts <url> [...]    # CLI brand-detection debug; add RENDER_SAMPLE=1 to also render a PDF per URL
```

MCP package (separate `package.json`, separate `node_modules`):
```bash
cd mcp && npm install && npm run build   # tsc -> mcp/dist/
```

## Architecture

**Render pipeline** (`src/render/`): `markdown.ts` (remark/rehype, `allowDangerousHtml: false`) produces HTML → a theme from `themes/` (`clean`/`executive`/`academic`/`technical`/`marketing`, plus an optional per-request `BrandKit`) supplies the CSS → `pdf.ts` prints it with Playwright. `detect.ts` is the other consumer of the render layer: it navigates a URL and reads computed styles/DOM signals (CSS custom properties, CTA background colors, scored logo `<img>` candidates, computed `font-family`) to produce a `BrandKit` — no LLM or image analysis involved, it reads values the browser already computed.

**Playwright context pool** (`src/render/pdf.ts`): `withPage()`/`htmlToPdf()` acquire a context from a pool bounded by `PLAYWRIGHT_MAX_CONTEXTS` (default 2), recycling a context after `MAX_RENDERS_PER_CONTEXT` (100) renders. Cleanup (`release()`) only runs in a `finally` **after** the wrapped function resolves — if a caller-supplied function hangs forever, the pool slot leaks permanently. `htmlToPdf()`'s own steps (`page.setContent`, `page.pdf()`) are timeout-bound by `RENDER_TIMEOUT_MS`, but `detect.ts`'s `page.evaluate()` is not — Playwright's `evaluate()` has no timeout parameter in its API at all. This is a known, verified gap (confirmed hang against a real site, `airbnb.com`, exceeding 60s with no resolution) — with a pool of 2, two such requests exhaust the render service for everyone until process restart. Be aware of this when touching `detect.ts` or the pool code; don't assume `RENDER_TIMEOUT_MS` bounds the detection path the way it bounds rendering.

**SSRF guard** (`src/lib/url-fetch.ts`): `assertPublicUrl()` resolves DNS and rejects RFC1918/loopback/link-local/IPv6 ULA. A public host can redirect to a private one, so both the Playwright navigation in `detect.ts` (re-checks `page.url()` after navigation) and the manual-redirect fetch loop in `src/lib/inline-image.ts` (checks every hop) re-validate rather than trusting the check on the original submitted URL alone. Any new code path that fetches a caller-supplied URL needs the same treatment, not just a single upfront check.

**Auth / billing model**: API keys (`src/lib/auth.ts`) are 192-bit random, stored as plaintext (so `/account` can display them back), with `revokedAt` implementing a timestamp-based grace window after rotation (`KEY_GRACE_PERIOD_HOURS`) rather than hard deletion. Credits (`src/lib/billing.ts`, `CreditTransaction` model) are debited per render but nothing charges real money — there's no Stripe/payment integration anywhere in this codebase.

**Admin surface** (`src/routes/admin.ts`): every `/admin/*` route 404s (not 401s) when `ADMIN_TOKEN` is unset, so a deployment without the env var has zero discoverable surface there, not just an unauthenticated one.

**Prisma models** (`prisma/schema.prisma`): `User` → `ApiKey`, `Document`, `CreditTransaction`, `BrandKit` (unique per `[userId, name]`, one row can hold either a saved kit or a `customCss` override). No migrations are committed — the Docker `CMD` runs `prisma db push --accept-data-loss` directly against the schema, so schema changes go live without a migration history.

**Repo layout note**: there used to be a marketing landing site (`landing/`) and a docs site (`docs/`) built by Docker at image-build time; both were deliberately removed (along with the scripts that built them) to make this a pure API + MCP repo. If you see references to either in old context, they no longer exist — don't try to restore them without being asked.
