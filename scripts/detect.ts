// CLI demo for brand-kit URL detection.
//   ./node_modules/.bin/tsx scripts/detect.ts https://stripe.com https://nytimes.com
//
// Prints the detected fields for each URL. Optionally renders a sample PDF for
// each URL using the detected kit + the "clean" theme (set RENDER_SAMPLE=1).

process.env.DATABASE_URL ??= 'postgresql://placeholder@localhost:5432/placeholder';
process.env.SIGNING_SECRET ??= 'preview-only-secret-not-used-anywhere-real-1234567890';
process.env.STORAGE_DIR ??= './samples';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: tsx scripts/detect.ts <url> [<url> ...]');
  process.exit(2);
}

const { detectBrandKit } = await import('../src/render/detect.js');
const { shutdownRenderer, htmlToPdf } = await import('../src/render/pdf.js');
const { markdownToHtml } = await import('../src/render/markdown.js');
const { buildHeaderHtml, buildFooterHtml, HEADER_FOOTER_MARGIN } = await import(
  '../src/render/themes/header-footer.js'
);
const { inlineImage } = await import('../src/lib/inline-image.js');

const renderSample = process.env.RENDER_SAMPLE === '1';
let markdown = '';
let title = 'paperpress detection sample';
if (renderSample) {
  markdown = readFileSync(join('samples', 'sample.md'), 'utf-8');
  const m = markdown.match(/^#\s+(.+)$/m);
  if (m) title = m[1]!;
}

for (const url of urls) {
  const t = Date.now();
  try {
    const kit = await detectBrandKit(url);
    const ms = Date.now() - t;
    const host = new URL(kit.sourceUrl).host;
    console.log(`\n${host}  (${ms}ms)`);
    console.log(`  primaryColor: ${kit.primaryColor ?? '—'}`);
    console.log(`  fontStyle:    ${kit.fontStyle ?? '—'}`);
    console.log(`  logoUrl:      ${kit.logoUrl ?? '—'}`);

    if (renderSample) {
      // Inline the logo so Playwright's header context can render it deterministically.
      const inlinedLogo = await inlineImage(kit.logoUrl);
      const renderKit = inlinedLogo ? { ...kit, logoUrl: inlinedLogo } : kit;
      const html = await markdownToHtml(markdown, { title, theme: 'clean', brandKit: renderKit });
      const { buffer, renderTimeMs } = await htmlToPdf(html, {
        headerHtml: buildHeaderHtml(renderKit, title),
        footerHtml: buildFooterHtml(renderKit),
        margin: HEADER_FOOTER_MARGIN,
      });
      const slug = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const out = join('samples', `detect-${slug}.pdf`);
      writeFileSync(out, buffer);
      console.log(
        `  preview:      ${out}  (${(buffer.length / 1024).toFixed(0)}KB, ${renderTimeMs}ms)` +
          (inlinedLogo ? '' : '  [logo not inlined]')
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n${url}\n  FAILED: ${msg}`);
  }
}

await shutdownRenderer();
process.exit(0);
