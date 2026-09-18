# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An API that detects a company's brand (logo, color, font) from its live URL and renders markdown into a PDF styled in that brand, in one HTTP call. A single Fastify process — REST API plus a hosted MCP endpoint (`src/routes/mcp.ts`), no separate package or install step.

Deliberately kept as a lean skeleton: this server, callable, nothing else. No payment processing (the credit system is a Postgres counter with no charge path), no automated test suite, no committed Prisma migrations (see Known gaps below). Don't add features toward a 1.0 unless explicitly asked — bug fixes and code-quality work are the useful contributions here.

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

## Architecture

**Render pipeline** (`src/render/`): `markdown.ts` (remark/rehype, `allowDangerousHtml: false`) produces HTML → a theme from `themes/` (`clean`/`executive`/`academic`/`technical`/`marketing`, plus an optional per-request `BrandKit`) supplies the CSS → `pdf.ts` prints it with Playwright. `detect.ts` is the other consumer of the render layer: it navigates a URL and reads computed styles/DOM signals (CSS custom properties, CTA background colors, scored logo `<img>` candidates, computed `font-family`) to produce a `BrandKit` — no LLM or image analysis involved, it reads values the browser already computed.

**Known, deliberately-unfixed detection gap**: `detect.ts` navigates with `waitUntil: 'domcontentloaded'`, so it reads the DOM before client-side JS hydrates. Works fine on server-rendered marketing pages; misses brand signals on pages whose real UI (buttons, colors) only exists after hydration (`open.spotify.com` — gets the logo from the static shell, misses the green because the CTA button doesn't exist yet at that point). Three fixes were tried and reverted in one session: `waitUntil: 'load'` (fixed it, but taxed every request 3-10x — Netflix went from ~1.2s to ~10.8s); a flat extra `waitForTimeout` (same problem, smaller); a conditional retry keyed on "first pass found zero signal" (didn't even work on its own target case, because the logo loads early from the static shell while the color-bearing button doesn't, so the retry never fired). If you're tempted to fix this, that history is worth reading first — each attempt looked reasonable in isolation and only failed once tested against more than the one site it was tuned against.

**Playwright context pool** (`src/render/pdf.ts`): `withPage()`/`htmlToPdf()` acquire a context from a pool bounded by `PLAYWRIGHT_MAX_CONTEXTS` (default 2), recycling a context after `MAX_RENDERS_PER_CONTEXT` (100) renders. Cleanup (`release()`) only runs in a `finally` **after** the wrapped function resolves — if a caller-supplied function hangs forever, the pool slot leaks permanently. `htmlToPdf()`'s own steps (`page.setContent`, `page.pdf()`) are timeout-bound by `RENDER_TIMEOUT_MS`, but `detect.ts`'s `page.evaluate()` is not — Playwright's `evaluate()` has no timeout parameter in its API at all. This is a known, verified gap (confirmed hang against a real site, `airbnb.com`, exceeding 60s with no resolution) — with a pool of 2, two such requests exhaust the render service for everyone until process restart. Be aware of this when touching `detect.ts` or the pool code; don't assume `RENDER_TIMEOUT_MS` bounds the detection path the way it bounds rendering.

**SSRF guard** (`src/lib/url-fetch.ts`): `assertPublicUrl()` resolves DNS and rejects RFC1918/loopback/link-local/IPv6 ULA. A public host can redirect to a private one, so both the Playwright navigation in `detect.ts` (re-checks `page.url()` after navigation) and the manual-redirect fetch loop in `src/lib/inline-image.ts` (checks every hop) re-validate rather than trusting the check on the original submitted URL alone. Any new code path that fetches a caller-supplied URL needs the same treatment, not just a single upfront check.

**Auth / billing model**: API keys (`src/lib/auth.ts`) are 192-bit random, stored as plaintext (so `/account` can display them back), with `revokedAt` implementing a timestamp-based grace window after rotation (`KEY_GRACE_PERIOD_HOURS`) rather than hard deletion. Credits (`src/lib/billing.ts`, `CreditTransaction` model) are debited per render but nothing charges real money — there's no Stripe/payment integration anywhere in this codebase.

**Admin surface** (`src/routes/admin.ts`): every `/admin/*` route 404s (not 401s) when `ADMIN_TOKEN` is unset, so a deployment without the env var has zero discoverable surface there, not just an unauthenticated one.

**Prisma models** (`prisma/schema.prisma`): `User` → `ApiKey`, `Document`, `CreditTransaction`, `BrandKit` (unique per `[userId, name]`, one row can hold either a saved kit or a `customCss` override). No migrations are committed — the Docker `CMD` runs `prisma db push --accept-data-loss` directly against the schema, so schema changes go live without a migration history.

**Repo layout note**: there used to be a marketing landing site (`landing/`) and a docs site (`docs/`) built by Docker at image-build time; both were deliberately removed (along with the scripts that built them) to make this a pure API + MCP repo. If you see references to either in old context, they no longer exist — don't try to restore them without being asked.

**Two remotes, two different jobs — don't confuse them**:
- `origin` → `github.com/rozetyp/paperpress` (public). The checked-out branch here is `oss-release`, pushed to that repo's `main` (`git push origin oss-release:main`). This is the documented, explained version — full README, differentiation writeup, deploy walkthrough.
- `private-repo` → `github.com/rozetyp/paperpress-private` (private). Its `main` branch has the original ~51-commit development history from when this was a real, briefly-running paid service; that history has never been audited for secrets and the repo has stayed private specifically for that reason — don't propose making it public. It's kept in sync by adding new commits on top of that history (via `git commit-tree` + `git update-ref`, not merge or rebase) so nothing is ever force-pushed or rewritten. Its README is deliberately terse (presence + buildability, not documentation) — don't copy the public repo's expanded README onto it.

If asked to update "the repo" without qualification, ask which one, or update both appropriately rather than assuming they should read the same.
