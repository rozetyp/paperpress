import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

export function generateApiKey(): { key: string; prefix: string } {
  const raw = randomBytes(24).toString('base64url');
  const key = `pp_live_${raw}`;
  return { key, prefix: key.slice(0, 12) };
}

export type AuthedUser = {
  id: string;
  email: string;
  credits: number;
  apiKeyId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'missing_api_key' });
    return;
  }
  const key = header.slice(7).trim();
  if (!key.startsWith('pp_')) {
    reply.code(401).send({ error: 'invalid_api_key' });
    return;
  }

  const record = await prisma.apiKey.findUnique({
    where: { key },
    include: { user: true },
  });

  // revokedAt is null = active. A future timestamp = inside grace window.
  // Anything else means the key is dead.
  const now = new Date();
  if (!record || (record.revokedAt && record.revokedAt <= now)) {
    reply.code(401).send({ error: 'invalid_api_key' });
    return;
  }

  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: now } })
    .catch(() => {});

  req.user = {
    id: record.user.id,
    email: record.user.email,
    credits: record.user.credits,
    apiKeyId: record.id,
  };
}
