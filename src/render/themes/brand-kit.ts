// Brand kit → CSS overrides. A brand kit sits on top of a named theme and
// fills in CSS custom properties: colors, fonts, spacing. Anything not set
// falls through to the theme/base defaults.

export type FontStyle = 'serif' | 'sans' | 'mono';
export type Density = 'compact' | 'normal' | 'spacious';

export type BrandKit = {
  logoUrl?: string;
  primaryColor?: string;   // hex (#rrggbb)
  accentColor?: string;    // hex
  fontStyle?: FontStyle;
  /** Full CSS font-family stack (e.g. '"Eurostile", "Helvetica Neue", Arial, sans-serif').
   *  Wins over fontStyle when both are set. Detected from the live site's body. */
  fontFamily?: string;
  /** Optional separate heading stack (e.g. detected from h1 / h2). Falls back to fontFamily. */
  headingFontFamily?: string;
  density?: Density;
};

// A safe-character regex for CSS font-family values: letters, digits, space,
// quotes, commas, hyphens, and dots. Anything else (braces, semicolons, colons,
// backslashes) would break out of the CSS variable value and is rejected at
// the route validation layer; this is a second line of defense.
const FONT_FAMILY_SAFE = /^[a-zA-Z0-9\s,"'\-.]+$/;
function safeFamily(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  if (!trimmed || trimmed.length > 200) return undefined;
  return FONT_FAMILY_SAFE.test(trimmed) ? trimmed : undefined;
}

const FONT_STACKS: Record<FontStyle, string> = {
  serif: "'Source Serif Pro', Georgia, 'Times New Roman', serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

const DENSITY_SCALE: Record<Density, number> = {
  compact: 0.85,
  normal: 1,
  spacious: 1.25,
};

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// WCAG relative luminance. 0 = black, 1 = white.
function relativeLuminance(hex: string): number {
  const m = hex.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!m) return 0.5;
  const lin = [m[1], m[2], m[3]]
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

// Is the color usable as text on the theme's near-white page background?
// We need ~3:1 contrast for large text (WCAG AA). Against #fff that means
// luminance ≤ ~0.43. We pick a slightly tighter bound (0.5) so borderline
// cases still produce readable headings.
export function usableAsText(hex: string): boolean {
  return relativeLuminance(hex) < 0.5;
}

export function compileBrandKit(kit: BrandKit): string {
  const decls: string[] = [];

  if (kit.primaryColor) {
    // Brands like vercel.com legitimately use near-white (#fafafa) as their
    // primary color. Faithfully echoing that into --pp-accent (which themes
    // use for h1/h2 type colors) makes headings invisible against the page.
    // When the color is too light for text, skip the type-color override so
    // theme defaults take over; still emit the soft tint for backgrounds
    // (header strip, borders, table headers) that can paint on top.
    if (usableAsText(kit.primaryColor)) {
      decls.push(`  --pp-accent: ${kit.primaryColor};`);
    }
    decls.push(`  --pp-accent-soft: ${hexToRgba(kit.primaryColor, 0.08)};`);
    decls.push(`  --pp-brand-color: ${kit.primaryColor};`);
  }
  // accentColor reserved for future use (charts, callouts) — emitted as a var
  // so downstream stylesheets can reach for it.
  if (kit.accentColor) {
    decls.push(`  --pp-accent-2: ${kit.accentColor};`);
  }
  // Font precedence: explicit fontFamily/headingFontFamily win, then the
  // coarse fontStyle bucket, then nothing (theme defaults). When we have a
  // detected fontFamily we append a sensible fallback so the renderer still
  // has a generic family if the named one isn't installed in Chromium.
  const body = safeFamily(kit.fontFamily);
  const heading = safeFamily(kit.headingFontFamily) ?? body;
  if (body) {
    const generic = kit.fontStyle ?? 'sans';
    const fallback =
      generic === 'serif' ? 'serif' : generic === 'mono' ? 'monospace' : 'sans-serif';
    decls.push(`  --pp-font-body: ${body}, ${fallback};`);
    decls.push(`  --pp-font-heading: ${heading}, ${fallback};`);
  } else if (kit.fontStyle) {
    decls.push(`  --pp-font-body: ${FONT_STACKS[kit.fontStyle]};`);
    // Pair body font with a complementary heading font:
    //   serif body → sans headings (classic editorial pairing)
    //   sans body  → sans headings (modern, single-family)
    //   mono body  → sans headings (mono everywhere is unreadable)
    // (every fontStyle pairs with sans, so this is always FONT_STACKS.sans)
    decls.push(`  --pp-font-heading: ${FONT_STACKS.sans};`);
  }
  if (kit.density) {
    decls.push(`  --pp-spacing-scale: ${DENSITY_SCALE[kit.density]};`);
  }

  if (decls.length === 0) return '';

  // Comment header so generated CSS is debuggable when inspected
  return `/* brand kit overrides */\n:root {\n${decls.join('\n')}\n}`;
}
