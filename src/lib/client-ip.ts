import type { FastifyRequest } from 'fastify';

// The address every per-IP limit keys on. Railway's edge sets X-Real-IP to
// the caller's address and doesn't pass a client-supplied one through.
// req.ip can't be used there: the request crosses more than one proxy hop and
// the hop nearest the app is a rotating edge address, so limits would be per
// edge node, not per caller. Outside Railway (local dev) the header is
// absent and this falls back to the socket address. Deploying behind a proxy
// that does NOT overwrite X-Real-IP would make it spoofable.
export function clientIp(req: FastifyRequest): string {
  const header = req.headers['x-real-ip'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || req.ip;
}
