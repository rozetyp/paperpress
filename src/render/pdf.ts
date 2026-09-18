import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../env.js';

type PoolEntry = { context: BrowserContext; inUse: boolean; renders: number };

let browser: Browser | undefined;
const pool: PoolEntry[] = [];
const MAX_RENDERS_PER_CONTEXT = 100;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

async function acquire(): Promise<PoolEntry> {
  const free = pool.find((e) => !e.inUse);
  if (free) {
    free.inUse = true;
    return free;
  }
  if (pool.length < env.PLAYWRIGHT_MAX_CONTEXTS) {
    const b = await getBrowser();
    const context = await b.newContext({
      viewport: { width: 1240, height: 1754 },
      bypassCSP: true,
    });
    const entry: PoolEntry = { context, inUse: true, renders: 0 };
    pool.push(entry);
    return entry;
  }
  // All in use: wait briefly and retry.
  await new Promise((r) => setTimeout(r, 50));
  return acquire();
}

async function release(entry: PoolEntry): Promise<void> {
  entry.renders += 1;
  if (entry.renders >= MAX_RENDERS_PER_CONTEXT) {
    await entry.context.close().catch(() => {});
    const idx = pool.indexOf(entry);
    if (idx >= 0) pool.splice(idx, 1);
    return;
  }
  entry.inUse = false;
}

// Generic page borrow from the pool. Used by both PDF rendering and brand-kit
// detection (which navigates to a public URL to read meta tags / computed styles).
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const entry = await acquire();
  const page = await entry.context.newPage();
  try {
    page.setDefaultTimeout(env.RENDER_TIMEOUT_MS);
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await release(entry);
  }
}

export type RenderOptions = {
  format?: 'A4' | 'Letter' | 'Legal';
  landscape?: boolean;
  /** HTML for repeating page header (Playwright headerTemplate). */
  headerHtml?: string;
  /** HTML for repeating page footer (Playwright footerTemplate). */
  footerHtml?: string;
  /** Page margins. Required when headerHtml/footerHtml are set so they don't crash into content. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
};

export type RenderResult = {
  buffer: Buffer;
  renderTimeMs: number;
};

export async function htmlToPdf(html: string, options: RenderOptions = {}): Promise<RenderResult> {
  const start = Date.now();
  const entry = await acquire();
  const page = await entry.context.newPage();
  try {
    page.setDefaultTimeout(env.RENDER_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: 'load', timeout: env.RENDER_TIMEOUT_MS });
    await page.emulateMedia({ media: 'print' });

    const hasHeaderOrFooter = Boolean(options.headerHtml || options.footerHtml);

    const pdfBuffer = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      // When a header/footer is set, we provide explicit margins. The @page
      // rule in the document CSS would otherwise win and clip them.
      preferCSSPageSize: !hasHeaderOrFooter,
      displayHeaderFooter: hasHeaderOrFooter,
      headerTemplate: options.headerHtml ?? '<span></span>',
      footerTemplate: options.footerHtml ?? '<span></span>',
      margin: options.margin,
    });

    return { buffer: Buffer.from(pdfBuffer), renderTimeMs: Date.now() - start };
  } finally {
    await page.close().catch(() => {});
    await release(entry);
  }
}

export async function countPdfPages(buffer: Buffer): Promise<number> {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 1;
}

export async function shutdownRenderer(): Promise<void> {
  for (const e of pool) {
    await e.context.close().catch(() => {});
  }
  pool.length = 0;
  if (browser) {
    await browser.close().catch(() => {});
    browser = undefined;
  }
}
