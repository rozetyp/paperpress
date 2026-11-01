import type { FastifyInstance } from 'fastify';
import { RenderInput, RenderError, renderDocument } from '../render/document.js';
import { takeRenderToken } from '../lib/render-limit.js';
import { clientIp } from '../lib/client-ip.js';

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/documents', async (req, reply) => {
    const parsed = RenderInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    const token = takeRenderToken(clientIp(req));
    if (!token.ok) {
      reply.header('Retry-After', String(token.retryAfterSec));
      return reply.code(429).send({ error: 'rate_limited', retryAfterSec: token.retryAfterSec });
    }

    try {
      return reply.send(await renderDocument(parsed.data));
    } catch (err) {
      if (err instanceof RenderError) return reply.code(err.status).send(err.body);
      req.log.error({ err }, 'render_failed');
      return reply.code(500).send({
        error: 'render_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
