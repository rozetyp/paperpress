// Render favicon.svg to raster PNGs at the sizes the modern web actually
// asks for. Output: landing/apple-touch-icon.png (180), landing/favicon-32.png,
// landing/favicon.ico (a 32x32 PNG with a .ico extension - modern browsers
// accept the PNG bytes; this covers the /favicon.ico that Twitter, Slack,
// scrapers, and older clients fetch by convention).

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

async function renderAt(svg: string, size: number): Promise<Buffer> {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
         html,body{margin:0;padding:0;background:transparent;height:100%;}
         img{display:block;width:100%;height:100%;}
       </style></head>
       <body><img src="${dataUrl}"></body></html>`,
      { waitUntil: 'load' },
    );
    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    return buf;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const svg = await readFile('landing/favicon.svg', 'utf-8');

  const png180 = await renderAt(svg, 180);
  await writeFile('landing/apple-touch-icon.png', png180);
  console.log(`wrote landing/apple-touch-icon.png (${png180.byteLength} bytes)`);

  const png32 = await renderAt(svg, 32);
  await writeFile('landing/favicon-32.png', png32);
  await writeFile('landing/favicon.ico', png32);
  console.log(`wrote landing/favicon-32.png + landing/favicon.ico (${png32.byteLength} bytes each)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
