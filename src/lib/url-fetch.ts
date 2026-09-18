import { lookup } from 'node:dns/promises';

// RFC1918 + loopback + link-local + IPv6 unique-local / link-local.
// We resolve DNS first so a hostname that resolves to a private IP is rejected
// (defeats DNS rebinding to localhost / metadata services).
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
];
const PRIVATE_V6 = [
  /^::1$/i,
  /^::ffff:/i,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
];

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) return PRIVATE_V6.some((re) => re.test(ip));
  return PRIVATE_V4.some((re) => re.test(ip));
}

export class UrlValidationError extends Error {
  constructor(public reason: 'invalid_url' | 'unsupported_protocol' | 'private_address' | 'dns_failure') {
    super(reason);
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlValidationError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlValidationError('unsupported_protocol');
  }

  let address: string;
  try {
    const result = await lookup(url.hostname, { all: false });
    address = result.address;
  } catch {
    throw new UrlValidationError('dns_failure');
  }

  if (isPrivateAddress(address)) {
    throw new UrlValidationError('private_address');
  }

  return url;
}
