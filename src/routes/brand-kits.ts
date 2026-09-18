import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireApiKey } from '../lib/auth.js';
import { isThemeName } from '../render/themes/index.js';
import { detectBrandKitCached, UrlValidationError } from '../render/detect.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// CSS font-family value: letters, digits, space, quotes, commas, hyphens, dots.
// Reject anything that could break out of `--pp-font-body: <value>;` (no `{}`,
// `;`, `:`, backslash, less-than, greater-than).
const FONT_FAMILY = z
  .string()
  .max(200)
  .regex(/^[a-zA-Z0-9\s,"'\-.]+$/, 'invalid font-family characters');

const BrandKitInput = z.object({
  name: z.string().min(1).max(64).optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(HEX_COLOR, 'must be #RRGGBB').optional(),
  accentColor: z.string().regex(HEX_COLOR, 'must be #RRGGBB').optional(),
  fontStyle: z.enum(['serif', 'sans', 'mono']).optional(),
  fontFamily: FONT_FAMILY.optional(),
  headingFontFamily: FONT_FAMILY.optional(),
  density: z.enum(['compact', 'normal', 'spacious']).optional(),
  baseTheme: z.string().refine(isThemeName, 'unknown theme').optional(),
  customCss: z.string().max(50_000).optional(),
});

export async function brandKitRoutes(app: FastifyInstance): Promise<void> {
  // Create or upsert by name (per user).
  app.post('/v1/brand-kits', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = BrandKitInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const userId = req.user!.id;
    const name = parsed.data.name ?? 'default';

    const kit = await prisma.brandKit.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name, ...parsed.data },
      update: { ...parsed.data, name },
    });
    return reply.code(201).send(kit);
  });

  app.get('/v1/brand-kits', { preHandler: requireApiKey }, async (req) => {
    const userId = req.user!.id;
    const kits = await prisma.brandKit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { kits };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/brand-kits/:id',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const kit = await prisma.brandKit.findFirst({
        where: { id: req.params.id, userId: req.user!.id },
      });
      if (!kit) return reply.code(404).send({ error: 'not_found' });
      return kit;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/brand-kits/:id',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { count } = await prisma.brandKit.deleteMany({
        where: { id: req.params.id, userId: req.user!.id },
      });
      if (count === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    }
  );

  // The magic moment: paste a URL, get suggested brand-kit fields back.
  // Caller is expected to review the suggestions and POST a final kit to /v1/brand-kits,
  // or pass `brandFromUrl` directly to /v1/documents to do detect + render in one trip.
  // Cached for 24h per URL; pass { refresh: true } to bypass.
  app.post('/v1/brand-kits/detect', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = z
      .object({ url: z.string().min(1).max(2048), refresh: z.boolean().optional() })
      .safeParse(req.body);
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
  });

  // Batch detect: enrich up to 20 URLs in parallel through the existing
  // Playwright pool. Per-item errors come back inline; a single failure
  // never tanks the whole batch.
  app.post('/v1/brand-kits/detect-batch', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = z
      .object({
        urls: z.array(z.string().min(1).max(2048)).min(1).max(20),
        refresh: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    const start = Date.now();
    const results = await Promise.all(
      parsed.data.urls.map(async (url) => {
        try {
          const detected = await detectBrandKitCached(url, { refresh: parsed.data.refresh });
          return { url, ok: true as const, detected };
        } catch (err) {
          if (err instanceof UrlValidationError) {
            return { url, ok: false as const, error: err.reason };
          }
          return {
            url,
            ok: false as const,
            error: err instanceof Error ? err.message : 'unknown',
          };
        }
      }),
    );

    return reply.send({
      results,
      count: results.length,
      succeeded: results.filter((r) => r.ok).length,
      elapsedMs: Date.now() - start,
    });
  });
}
