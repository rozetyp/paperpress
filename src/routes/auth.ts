import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { generateApiKey } from '../lib/auth.js';
import { sendEmail, keyEmailBody } from '../lib/email.js';
import { env } from '../env.js';

const RegisterBody = z.object({
  email: z.string().email(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Unified "request a key" endpoint.
  //   - New email      → create user with FREE_TIER_CREDITS, mint a key, email it.
  //   - Existing email → mint a new key, schedule the old active keys to revoke
  //                      at end of KEY_GRACE_PERIOD_HOURS, email the new one.
  // Always responds 202 so the endpoint doesn't reveal which emails are
  // registered. The actual work runs after the response.
  app.post('/auth/register', async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const { email } = parsed.data;

    void (async () => {
      try {
        const existing = await prisma.user.findUnique({ where: { email } });
        const user =
          existing ??
          (await prisma.user.create({ data: { email, credits: env.FREE_TIER_CREDITS } }));

        if (existing) {
          const revokeAt = new Date(
            Date.now() + env.KEY_GRACE_PERIOD_HOURS * 3600 * 1000,
          );
          await prisma.apiKey.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: revokeAt },
          });
        }

        const { key, prefix } = generateApiKey();
        await prisma.apiKey.create({
          data: { userId: user.id, key, prefix },
        });

        await sendEmail({
          to: email,
          subject: existing ? 'Your new paperpress API key' : 'Welcome to paperpress',
          text: keyEmailBody(key, !existing),
        });
      } catch (err) {
        app.log.error({ err, email }, 'register_failed');
      }
    })();

    return reply.code(202).send({ sent: true });
  });
}
