import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { detectBrandKitCached, UrlValidationError } from '../render/detect.js';

const Body = z.object({ url: z.string().min(1).max(2048), refresh: z.boolean().optional() });

export async function detectRoutes(app: FastifyInstance): Promise<void> {
  // Paste a URL, get the detected brand back (primaryColor, logoUrl, favicon,
  // fontFamily, fontStyle). Pass the fields as an inline brandKit to
  // /v1/documents, or pass brandFromUrl there to detect + render in one trip.
  // Cached for 24h per URL; pass { refresh: true } to bypass.
  app.post(
    '/v1/detect',
    {
      // Per-IP, same budget as /v1/demo: a cache miss is a full Chromium
      // navigation.
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
      }
      try {
        const detected = await detectBrandKitCached(parsed.data.url, {
          refresh: parsed.data.refresh,
        });
        return reply.send({ detected });
      } catch (err) {
        if (err instanceof UrlValidationError) {
          return reply.code(400).send({ error: err.reason });
        }
        req.log.warn({ err, url: parsed.data.url }, 'detect_failed');
        return reply.code(502).send({
          error: 'detection_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
