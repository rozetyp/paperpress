# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An API that detects a company's brand (logo, color, font) from its live URL and renders markdown into a PDF styled in that brand, in one HTTP call. A single Fastify process — REST API plus a hosted MCP endpoint (`src/routes/mcp.ts`), no separate package or install step.

Deliberately kept as a lean skeleton: this server, callable, nothing else. No accounts, no API keys, no database — every endpoint is anonymous and bounded by per-IP rate limits. No automated test suite. Don't add features toward a 1.0 unless explicitly asked — bug fixes and code-quality work are the useful contributions here.

## Commands

```bash
npm run dev              # tsx watch src/index.ts — local dev server
npm run build             # tsc -> dist/
npm start                 # node dist/index.js (run build first)
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

**Playwright context pool** (`src/render/pdf.ts`): `withPage()`/`htmlToPdf()` acquire a context from a pool bounded by `PLAYWRIGHT_MAX_CONTEXTS` (default 2), recycling a context after `MAX_RENDERS_PER_CONTEXT` (100) renders. `withPage()` races the whole wrapped function against `RENDER_TIMEOUT_MS` and, on timeout, throws the context away (`discard()`) instead of returning it to the pool. That's there because Playwright's `page.evaluate()` has no timeout parameter at all: before the guard, a page that never settled (verified against `airbnb.com`, 60s+ with no resolution) held its slot forever, and with a pool of 2, two such requests took the service down until restart. Keep that guard in place if you touch `detect.ts` or the pool. Separately, `acquire()` isn't atomic across concurrent cold-start calls (each sees `pool.length < max` before any context exists), so a burst on an empty pool can briefly create more than `PLAYWRIGHT_MAX_CONTEXTS` contexts.

**SSRF guard** (`src/lib/url-fetch.ts`): `assertPublicUrl()` resolves DNS and rejects RFC1918/loopback/link-local/IPv6 ULA. A public host can redirect to a private one, so both the Playwright navigation in `detect.ts` (re-checks `page.url()` after navigation) and the manual-redirect fetch loop in `src/lib/inline-image.ts` (checks every hop) re-validate rather than trusting the check on the original submitted URL alone. Any new code path that fetches a caller-supplied URL needs the same treatment, not just a single upfront check.

**No accounts, by design**: API keys, credits, email key delivery, saved brand kits, an admin dashboard and Postgres/Prisma all existed and were removed (v0.2.0). The key flow emailed keys via Resend, which was never configured on the live deploy, so nobody could actually get a key and the MCP tool was unusable by anyone but the owner. Don't reintroduce an account system unless asked. What protects the Chromium pool instead: `takeRenderToken()` (`src/lib/render-limit.ts`), a per-IP hourly budget (`RENDERS_PER_HOUR`, default 30) shared by `POST /v1/documents` and the MCP `generate_pdf` tool, plus route-level `@fastify/rate-limit` on `/v1/detect` and `/v1/demo` (30/hour/IP) and a global 60/min/IP. `src/render/document.ts` holds the shared validation + render path both entry points call — the MCP route calls it directly rather than looping back over HTTP, which would make every MCP caller look like `127.0.0.1` to the limiter. Every limit keys on `clientIp()` (`src/lib/client-ip.ts`): Railway's `X-Real-IP` header, falling back to `req.ip` locally. Don't switch back to `req.ip` + `trustProxy` — requests cross more than one proxy hop, the hop nearest the app is a rotating Railway edge address (`79.127.x.x`), and `trustProxy: 1` was tried and verified in production to key limits on those edge nodes instead of callers. PDFs are files on the volume named by a random UUID; the HMAC signature on `/pdf/:id` covers the id, which is also what keeps it safe as a filename.

**Repo layout note**: there used to be a marketing landing site (`landing/`) and a docs site (`docs/`) built by Docker at image-build time; both were deliberately removed (along with the scripts that built them) to make this a pure API + MCP repo. If you see references to either in old context, they no longer exist — don't try to restore them without being asked.

**Two remotes, two different jobs — don't confuse them**:
- `origin` → `github.com/rozetyp/paperpress` (public). The checked-out branch here is `oss-release`, pushed to that repo's `main` (`git push origin oss-release:main`). This is the documented, explained version — full README, differentiation writeup, deploy walkthrough.
- `private-repo` → `github.com/rozetyp/paperpress-private` (private). Its `main` branch has the original ~51-commit development history from when this was a real, briefly-running paid service; that history has never been audited for secrets and the repo has stayed private specifically for that reason — don't propose making it public. It's kept in sync by adding new commits on top of that history (via `git commit-tree` + `git update-ref`, not merge or rebase) so nothing is ever force-pushed or rewritten. Its README is deliberately terse (presence + buildability, not documentation) — don't copy the public repo's expanded README onto it.

If asked to update "the repo" without qualification, ask which one, or update both appropriately rather than assuming they should read the same.
