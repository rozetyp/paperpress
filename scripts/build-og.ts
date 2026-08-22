// Build the social-card (Open Graph / Twitter) image at landing/og-image.png.
// Renders an HTML template in Chromium at 1200x630, screenshots it, writes PNG.
// Runs as part of the Docker build so the asset is always in sync with the
// landing copy without committing a binary that drifts.

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = 'landing/og-image.png';

const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 630px;
    background:
      radial-gradient(ellipse at top right, rgba(193, 88, 60, 0.10), transparent 60%),
      radial-gradient(ellipse at bottom left, rgba(28, 24, 20, 0.06), transparent 60%),
      #fbf8f2;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    color: #1c1814;
    padding: 72px 80px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand svg { width: 44px; height: 44px; color: #1c1814; }
  .brand .name { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: #1c1814; }
  h1 {
    font-family: ui-serif, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif;
    font-size: 88px;
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: #1c1814;
    max-width: 940px;
  }
  h1 .accent { color: #c1583c; }
  p.lede {
    font-size: 26px;
    color: #7a716a;
    margin-top: 22px;
    max-width: 820px;
    line-height: 1.35;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #7a716a;
    font-size: 18px;
  }
  .footer .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tag {
    display: inline-block;
    padding: 6px 14px;
    border: 1px solid #d4ccbc;
    border-radius: 999px;
    font-size: 14px;
    color: #7a716a;
    background: rgba(255,255,255,0.6);
  }
</style>
</head>
<body>
  <div>
    <div class="brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="14" y2="13"/>
        <line x1="8" y1="17" x2="14" y2="17"/>
      </svg>
      <span class="name">paperpress</span>
      <span class="tag">Brand-aware document API</span>
    </div>
    <h1 style="margin-top:64px">Markdown in.<br><span class="accent">Their brand out.</span></h1>
    <p class="lede">Detect any company's brand from a URL. Render PDFs and social cards in that brand. Built for sales agents, white-label SaaS, and agencies.</p>
  </div>
  <div class="footer">
    <span class="url">paperpress-production.up.railway.app</span>
    <span>brand detect &middot; PDF &middot; social card</span>
  </div>
</body>
</html>`;

async function main(): Promise<void> {
  await mkdir(dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.screenshot({ type: 'png', omitBackground: false });
    await writeFile(OUT, buffer);
    console.log(`wrote ${OUT} (${buffer.byteLength} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
