import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireApiKey } from '../lib/auth.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/account', { preHandler: requireApiKey }, async (req) => {
    const now = new Date();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: {
        email: true,
        credits: true,
        createdAt: true,
        apiKeys: {
          where: { OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] },
          select: {
            key: true,
            prefix: true,
            createdAt: true,
            lastUsedAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return user;
  });
}
