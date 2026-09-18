import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../env.js';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

async function ensureDir(): Promise<void> {
  await mkdir(env.STORAGE_DIR, { recursive: true });
}

export async function savePdf(
  documentId: string,
  buffer: Buffer,
): Promise<{ path: string; bytes: number }> {
  await ensureDir();
  const path = join(env.STORAGE_DIR, `${documentId}.pdf`);
  await writeFile(path, buffer);
  const s = await stat(path);
  return { path, bytes: s.size };
}

export async function readPdf(documentId: string): Promise<Buffer> {
  const path = join(env.STORAGE_DIR, `${documentId}.pdf`);
  return readFile(path);
}

function sign(documentId: string, exp: number): string {
  return createHmac('sha256', env.SIGNING_SECRET).update(`${documentId}:${exp}`).digest('hex');
}

export function signedUrl(documentId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(documentId, exp);
  return `${env.PUBLIC_BASE_URL}/pdf/${documentId}?exp=${exp}&sig=${sig}`;
}

export function verifySignature(documentId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(documentId, exp);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
