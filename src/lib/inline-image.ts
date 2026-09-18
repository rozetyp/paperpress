// Fetch an image URL, return it as a base64 data: URL.
//
// Playwright's headerTemplate runs in an isolated frame at print time. External
// images often fail to load there (CORP/COEP headers, fresh redirects, slow
// CDNs racing against PDF render). Inlining as a data URL fixes all of that.

import { assertPublicUrl } from './url-fetch.js';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TIMEOUT_MS = 8000;
const USER_AGENT = 'paperpress/0.1';
const MAX_REDIRECTS = 5;

export async function inlineImage(url: string | undefined | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let current = url;
    // Manual redirect loop: assertPublicUrl only proves the URL we were
    // handed resolves to a public address. A public host can 3xx to a
    // private/loopback one, and fetch()'s default redirect:'follow' would
    // walk there with no further check. Validate every hop before following it.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ct.startsWith('image/')) return null;
      // Read with size cap.
      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
    return null; // too many redirects
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
