import { env } from '../env.js';

// Per-IP hourly render budget, shared by /v1/documents and the MCP tool. The
// route-level @fastify/rate-limit can't do this on its own: one MCP tool call
// arrives alongside initialize / tools/list requests on the same route, and
// only the tool call should spend the budget.
//
// In-memory, so it resets on restart and wouldn't hold across replicas —
// same trade-off as the detect cache.

const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function takeRenderToken(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  if (bucket.count >= env.RENDERS_PER_HOUR) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

// Drop expired buckets so the map doesn't grow with every IP ever seen.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip);
}, WINDOW_MS).unref();
