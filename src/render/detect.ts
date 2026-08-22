import type { Page } from 'playwright';
import namer from 'color-namer';
import { withPage } from './pdf.js';
import { assertPublicUrl, UrlValidationError } from '../lib/url-fetch.js';
import type { BrandKit } from './themes/brand-kit.js';

export type PaletteEntry = { hex: string; name: string };

export type DetectedKit = Pick<
  BrandKit,
  'primaryColor' | 'logoUrl' | 'fontStyle' | 'fontFamily' | 'headingFontFamily'
> & {
  sourceUrl: string;
  /** Small icon-shaped asset: apple-touch-icon, SVG favicon, or favicon.ico.
   *  Kept separate from logoUrl so callers can show both. Favicons are good
   *  for browser tabs; real logos are good for documents and social cards. */
  favicon?: string;
  /** Top scored brand colors with NTC-derived names. First entry mirrors
   *  primaryColor. Empty if nothing brand-shaped was detected. */
  palette?: PaletteEntry[];
  /** All header-logo candidates we found, ranked. logoUrl is logos[0]. */
  logos?: string[];
};

function colorName(hex: string): string {
  try {
    const r = namer(hex, { pick: ['ntc'] }).ntc[0];
    return r?.name ?? hex;
  } catch {
    return hex;
  }
}

// Strip leading/trailing whitespace and clamp to the safe character set used
// by compileBrandKit. Discards anything that could break out of CSS.
const FONT_FAMILY_SAFE_RE = /^[a-zA-Z0-9\s,"'\-.]+$/;
function sanitizeFontFamily(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 200) return undefined;
  // Drop the generic fallback if it's the only thing (no useful brand signal).
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace)$/i.test(trimmed)) {
    return undefined;
  }
  if (!FONT_FAMILY_SAFE_RE.test(trimmed)) return undefined;
  return trimmed;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/;

function normalizeHex(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  const trimmed = c.trim();
  if (!HEX_RE.test(trimmed)) return undefined;
  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  return `#${hex.toLowerCase()}`;
}

function rgbStringToHex(rgb: string): string | undefined {
  const m = rgb.match(RGB_RE);
  if (!m) return undefined;
  // Skip near-transparent colors (alpha < 0.5).
  if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return undefined;
  const r = parseInt(m[1]!, 10);
  const g = parseInt(m[2]!, 10);
  const b = parseInt(m[3]!, 10);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function parseColor(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const direct = normalizeHex(input);
  if (direct) return direct;
  return rgbStringToHex(input.trim());
}

// Filter out near-grayscale and near-white/black colors (chrome doesn't count
// as a "brand color"). A color is "interesting" if its channels differ enough.
function isInterestingHex(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 25) return false; // too gray
  if (max < 30) return false; // too dark (basically black)
  if (min > 240) return false; // too light (basically white)
  return true;
}

export { UrlValidationError };

// ---------- Detection cache ----------
//
// First visit to a URL spins up a Chromium page (~1-3 s). Subsequent visits
// from any caller return in microseconds. Cache stores in-flight promises too,
// so a thundering herd of requests for the same URL collapses into one detect.
//
// In-memory only — fine while the service is single-instance on Railway. If
// we ever go multi-replica, move this to Redis or a Postgres row with a
// short TTL. The data is non-sensitive so cross-tenant sharing is OK; the
// detector returns the same answer regardless of who asked.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
type CacheEntry = { kit: Promise<DetectedKit>; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

export async function detectBrandKitCached(
  rawUrl: string,
  opts: { refresh?: boolean } = {},
): Promise<DetectedKit> {
  const key = cacheKey(rawUrl);
  const now = Date.now();
  const hit = cache.get(key);
  if (!opts.refresh && hit && hit.expiresAt > now) {
    return hit.kit;
  }
  const kit = detectBrandKit(rawUrl).catch((err: unknown) => {
    // Don't let a failed detect poison the cache. Evict and rethrow.
    cache.delete(key);
    throw err;
  });
  cache.set(key, { kit, expiresAt: now + CACHE_TTL_MS });
  return kit;
}

export function clearDetectCache(): void {
  cache.clear();
}

export async function detectBrandKit(rawUrl: string): Promise<DetectedKit> {
  const url = await assertPublicUrl(rawUrl);

  return withPage(async (page) => {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Re-check after navigation: assertPublicUrl only validated the URL the
    // caller submitted. A public host can respond with an HTTP redirect (or
    // client-side navigation) to a private/loopback/link-local address, and
    // Playwright follows it before we get a say. Bail before extracting
    // anything from the page if the final location isn't public. This closes
    // the request/response loop (no data is read back to the caller) but the
    // browser process will still have made the initial connection attempt —
    // full prevention would require pinning the resolved IP at the network
    // layer, which this guard doesn't do.
    await assertPublicUrl(page.url());

    // Inlined as a single expression to avoid tsx/esbuild injecting `__name`
    // helper into nested arrow functions, which breaks page.evaluate.
    // The page returns raw signals; final color picking happens in Node below.
    const raw = (await page.evaluate(`(() => {
      const sel = (s, a) => { const el = document.querySelector(s); return el ? el.getAttribute(a) : null; };

      const themeColor = sel('meta[name="theme-color"]', 'content');

      // Try common brand-related CSS custom properties on <html>.
      const rs = getComputedStyle(document.documentElement);
      const varNames = ['--brand', '--brand-primary', '--brand-color', '--primary', '--primary-color', '--color-primary', '--accent', '--accent-color', '--color-accent', '--theme-primary'];
      const cssVarValues = [];
      for (const v of varNames) {
        const val = rs.getPropertyValue(v).trim();
        if (val) cssVarValues.push(val);
      }

      // Sample CTA-like elements' background-color. Skip footers/navs.
      const ctaSelector = 'button, a.btn, a.button, a[role="button"], [class*="cta" i], [class*="primary" i]:not(nav *):not(footer *)';
      const ctaBgs = [];
      const seen = new Set();
      const els = document.querySelectorAll(ctaSelector);
      for (let i = 0; i < els.length && ctaBgs.length < 30; i++) {
        const el = els[i];
        // skip if inside a footer or nav (defensive — some sites don't tag elements clearly)
        if (el.closest('footer, nav')) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && !seen.has(bg)) { seen.add(bg); ctaBgs.push(bg); }
      }

      // Favicon: small icon-shaped asset, good for browser tabs but a poor
      // stand-in for the real brand mark on a document or social card.
      const faviconCandidates = [
        sel('link[rel="apple-touch-icon"]', 'href'),
        sel('link[rel="apple-touch-icon-precomposed"]', 'href'),
        sel('link[rel~="icon"][type="image/svg+xml"]', 'href'),
        sel('link[rel~="icon"]', 'href'),
        sel('link[rel="shortcut icon"]', 'href'),
        sel('meta[property="og:image"]', 'content'),
      ].filter(Boolean);
      let faviconUrl = null;
      if (faviconCandidates.length > 0) {
        try { faviconUrl = new URL(faviconCandidates[0], location.href).toString(); } catch { faviconUrl = null; }
      } else {
        faviconUrl = new URL('/favicon.ico', location.origin).toString();
      }

      // Real header logo: the <img> a designer placed in the page header. Way
      // more representative of the brand than a 32x32 favicon. We scan visible
      // <img> elements inside <header>, <nav>, and "logo"-named containers,
      // then score by where they sit and whether they're SVG.
      const logoContainers = document.querySelectorAll(
        'header, nav, [class*="logo" i], [id*="logo" i], a[href="/"], a[href="' + location.origin + '/"]'
      );
      const seenImgs = new Set();
      const logoCands = [];
      for (let ci = 0; ci < logoContainers.length; ci++) {
        const container = logoContainers[ci];
        const cRect = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
        if (!cRect || cRect.top > 600) continue;
        const imgs = container.querySelectorAll('img');
        for (let ii = 0; ii < imgs.length; ii++) {
          const img = imgs[ii];
          if (seenImgs.has(img)) continue;
          seenImgs.add(img);
          const src = img.currentSrc || img.src;
          if (!src) continue;
          const rect = img.getBoundingClientRect();
          // Filter: must be visibly logo-shaped, near the top of the page.
          if (rect.width < 24 || rect.height < 16) continue;
          if (rect.width > 600 || rect.height > 300) continue;
          if (rect.top > 600) continue;
          const cs = getComputedStyle(img);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) continue;
          let abs;
          try { abs = new URL(src, location.href).toString(); } catch { continue; }
          // De-dupe against favicon — many sites reuse the same asset for both.
          if (abs === faviconUrl) continue;
          const pathOnly = abs.split('?')[0].split('#')[0].toLowerCase();
          const isSvg = pathOnly.endsWith('.svg') || abs.indexOf('data:image/svg') === 0;
          let score = 0;
          if (isSvg) score += 20;
          if (container.tagName === 'HEADER') score += 10;
          else if (container.tagName === 'NAV') score += 8;
          else if (container.tagName === 'A') score += 4;
          const cls = ((container.className || '') + ' ' + (container.id || '')).toString();
          if (/logo/i.test(cls)) score += 5;
          const ar = rect.width / rect.height;
          if (ar >= 1.0 && ar <= 6) score += 3;
          if (rect.top >= 0 && rect.top <= 120) score += 3;
          logoCands.push({ src: abs, score, w: Math.round(rect.width), h: Math.round(rect.height), isSvg });
        }
      }
      logoCands.sort((a, b) => b.score - a.score);
      // Return up to 3 header logo candidates so consumers can show variants.
      const headerLogos = [];
      const seenLogoUrls = new Set();
      for (const c of logoCands) {
        if (seenLogoUrls.has(c.src)) continue;
        seenLogoUrls.add(c.src);
        headerLogos.push(c.src);
        if (headerLogos.length >= 3) break;
      }
      const headerLogoUrl = headerLogos[0] ?? null;

      const bodyFontRaw = getComputedStyle(document.body).fontFamily || '';
      const bodyFont = bodyFontRaw.toLowerCase();
      let fontStyle = 'sans';
      if (/mono|courier|consolas|menlo|jetbrains/.test(bodyFont)) fontStyle = 'mono';
      else if (/sans/.test(bodyFont)) fontStyle = 'sans';
      else if (/serif|georgia|times|garamond|charter|baskerville/.test(bodyFont)) fontStyle = 'serif';

      // Heading font: first h1 we can find, else h2, else fall back to body.
      // Many brand sites have a distinctive display face on headings that
      // differs from the (often neutral) body font.
      let headingFontRaw = '';
      const h1 = document.querySelector('h1');
      const h2 = h1 ? null : document.querySelector('h2');
      const headingEl = h1 || h2;
      if (headingEl) headingFontRaw = getComputedStyle(headingEl).fontFamily || '';

      return { themeColor, cssVarValues, ctaBgs, faviconUrl, headerLogoUrl, headerLogos, fontStyle, bodyFont, bodyFontRaw, headingFontRaw };
    })()`)) as {
      themeColor: string | null;
      cssVarValues: string[];
      ctaBgs: string[];
      faviconUrl: string | null;
      headerLogoUrl: string | null;
      headerLogos: string[];
      fontStyle: 'serif' | 'sans' | 'mono';
      bodyFont: string;
      bodyFontRaw: string;
      headingFontRaw: string;
    };

    // Build a scored palette by combining every color signal we collected.
    // Each source contributes weighted points; we keep the top scored
    // "interesting" hexes (skipping near-white/black/gray chrome). The
    // primaryColor is the top entry, which preserves the spirit of the old
    // priority logic while exposing the rest as a palette.
    const scores = new Map<string, number>();
    const bump = (hex: string, n: number) => {
      scores.set(hex, (scores.get(hex) ?? 0) + n);
    };
    const themeHex = parseColor(raw.themeColor);
    if (themeHex && isInterestingHex(themeHex)) bump(themeHex, 10);
    for (const v of raw.cssVarValues) {
      const hex = parseColor(v);
      if (hex && isInterestingHex(hex)) bump(hex, 5);
    }
    for (const bg of raw.ctaBgs) {
      const hex = parseColor(bg);
      if (hex && isInterestingHex(hex)) bump(hex, 2);
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
    let primaryColor: string | undefined = ranked[0];
    // Last-resort fallback: theme-color even if "uninteresting" (vercel #fafafa,
    // github #24292f). Better than nothing, signals the brand's stated intent.
    if (!primaryColor && themeHex) {
      primaryColor = themeHex;
      ranked.push(themeHex);
    }
    const palette: PaletteEntry[] = ranked.slice(0, 5).map((hex) => ({ hex, name: colorName(hex) }));

    const fontFamily = sanitizeFontFamily(raw.bodyFontRaw);
    const headingFontFamily = sanitizeFontFamily(raw.headingFontRaw);

    // Prefer the real header logo over the favicon for the canonical logoUrl;
    // expose the full ranked list separately so landing pages can show variants.
    const logos = raw.headerLogos && raw.headerLogos.length > 0 ? raw.headerLogos : undefined;
    const logoUrl = raw.headerLogoUrl ?? raw.faviconUrl ?? undefined;
    const favicon = raw.faviconUrl ?? undefined;

    return {
      sourceUrl: url.toString(),
      primaryColor,
      logoUrl,
      favicon,
      logos,
      palette: palette.length > 0 ? palette : undefined,
      fontStyle: raw.fontStyle ?? undefined,
      fontFamily,
      headingFontFamily,
    };
  });
}
