// Renders samples/sample.md as PDFs for:
//   • each named theme (no brand kit)
//   • the "clean" theme with three demo brand kits applied
// Outputs samples/preview-<variant>.html and samples/preview-<variant>.pdf.
//
// Run with: ./node_modules/.bin/tsx scripts/preview.ts

process.env.DATABASE_URL ??= 'postgresql://placeholder@localhost:5432/placeholder';
process.env.SIGNING_SECRET ??= 'preview-only-secret-not-used-anywhere-real-1234567890';
process.env.STORAGE_DIR ??= './samples';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandKit, ThemeName } from '../src/render/themes/index.js';

const inputPath = join('samples', 'sample.md');
const markdown = readFileSync(inputPath, 'utf-8');

const titleMatch = markdown.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1] : 'paperpress preview';

import type { BrandKit } from '../src/render/themes/brand-kit.js';
import type { ThemeName } from '../src/render/themes/index.js';

const { markdownToHtml } = await import('../src/render/markdown.js');
const { THEME_NAMES } = await import('../src/render/themes/index.js');
const { htmlToPdf, shutdownRenderer } = await import('../src/render/pdf.js');

type Variant = {
  slug: string;
  theme?: ThemeName;
  brandKit?: BrandKit;
};

const variants: Variant[] = [
  ...THEME_NAMES.map((theme) => ({ slug: theme, theme })),
  {
    slug: 'kit-stripe',
    theme: 'clean',
    brandKit: { primaryColor: '#635bff', fontStyle: 'sans', density: 'normal' },
  },
  {
    slug: 'kit-forest',
    theme: 'clean',
    brandKit: { primaryColor: '#166534', fontStyle: 'serif', density: 'spacious' },
  },
  {
    slug: 'kit-mono-coral',
    theme: 'technical',
    brandKit: { primaryColor: '#dc2626', fontStyle: 'mono', density: 'compact' },
  },
];

console.log(`Rendering ${variants.length} variants for "${title}"\n`);

for (const v of variants) {
  const html = await markdownToHtml(markdown, {
    title,
    theme: v.theme,
    brandKit: v.brandKit,
  });
  const htmlPath = join('samples', `preview-${v.slug}.html`);
  writeFileSync(htmlPath, html);

  const { buffer, renderTimeMs } = await htmlToPdf(html);
  const pdfPath = join('samples', `preview-${v.slug}.pdf`);
  writeFileSync(pdfPath, buffer);

  const label = v.brandKit
    ? `${v.slug.padEnd(17)} (kit on ${v.theme})`
    : v.slug.padEnd(17);
  console.log(
    `  ${label.padEnd(36)}  ${(buffer.length / 1024).toFixed(0).padStart(4)} KB  ${String(renderTimeMs).padStart(5)}ms`
  );
}

await shutdownRenderer();
console.log('\nOpen any sample with:  open samples/preview-<slug>.pdf');
process.exit(0);
