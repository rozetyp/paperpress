import { chromium } from 'playwright';

async function main(): Promise<void> {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 1400 } });
  const p = await c.newPage();

  p.on('console', (m) => console.log(`  CONSOLE [${m.type()}] ${m.text()}`));
  p.on('pageerror', (err) => console.log(`  PAGEERROR ${err.message}`));
  p.on('requestfailed', (r) => console.log(`  REQFAIL ${r.url()} -- ${r.failure()?.errorText}`));
  p.on('response', (r) => {
    const u = r.url();
    if (u.includes('/v1/demo') || u.includes('/card/') || u.includes('/pdf/')) {
      console.log(`  [${r.status()}] ${u.slice(0, 110)} ct=${r.headers()['content-type'] || '-'}`);
    }
  });

  await p.goto('https://paperpress-production.up.railway.app/#try', { waitUntil: 'networkidle' });
  await p.locator('#try-form input[name="url"]').fill('stripe.com');
  await p.locator('#try-form button[type="submit"]').click();
  await p.waitForSelector('#try-result:not([hidden])', { timeout: 30_000 });
  // Wait a moment for the card to either load or fail
  await p.waitForTimeout(6000);

  const state = await p.evaluate(() => {
    const card = document.querySelector('.try-card-preview') as HTMLImageElement | null;
    const loading = document.querySelector('.try-card-loading') as HTMLElement | null;
    return {
      cardHidden: card?.hidden,
      cardSrc: card?.src.slice(0, 130),
      cardNaturalWidth: card?.naturalWidth,
      cardComplete: card?.complete,
      loadingHidden: loading?.hidden,
    };
  });
  console.log('  state:', JSON.stringify(state, null, 2));
  await b.close();
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
