import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireApiKey } from '../lib/auth.js';
import { markdownToHtml } from '../render/markdown.js';
import { htmlToPdf, countPdfPages } from '../render/pdf.js';
import { savePdf, signedUrl } from '../lib/storage.js';
import { chargeCredits, InsufficientCreditsError } from '../lib/billing.js';
import type { BrandKit, ThemeName } from '../render/themes/index.js';
import { buildHeaderHtml, buildFooterHtml, HEADER_FOOTER_MARGIN } from '../render/themes/header-footer.js';
import { inlineImage } from '../lib/inline-image.js';
import { assertPublicUrl, UrlValidationError } from '../lib/url-fetch.js';
import { detectBrandKitCached } from '../render/detect.js';
import { env } from '../env.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// The css field is injected raw inside <style>...</style>. A user-supplied
// "</style><script>..." would close the style block and execute arbitrary JS
// inside the Chromium pool — which sits on Railway's internal network and has
// bypassCSP enabled. Reject anything that looks like a tag escape.
const CSS_TAG_ESCAPE = /<\s*\/?\s*(style|script)\b/i;

const FONT_FAMILY = z
  .string()
  .max(200)
  .regex(/^[a-zA-Z0-9\s,"'\-.]+$/, 'invalid font-family characters');

const InlineBrandKit = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(HEX_COLOR).optional(),
  accentColor: z.string().regex(HEX_COLOR).optional(),
  fontStyle: z.enum(['serif', 'sans', 'mono']).optional(),
  fontFamily: FONT_FAMILY.optional(),
  headingFontFamily: FONT_FAMILY.optional(),
  density: z.enum(['compact', 'normal', 'spacious']).optional(),
});

const Body = z.object({
  markdown: z.string().min(1).max(500_000),
  title: z.string().max(200).optional(),
  format: z.enum(['A4', 'Letter', 'Legal']).optional(),
  landscape: z.boolean().optional(),
  theme: z.enum(['clean', 'executive', 'academic', 'technical', 'marketing']).optional(),
  /** Either a saved brand-kit ID/name (string) or an inline kit object. */
  brandKit: z.union([z.string().min(1).max(64), InlineBrandKit]).optional(),
  /** Shortcut: detect a kit from a public URL and apply it. Composes with
   *  brandKit (inline fields override detected ones). 24h-cached per URL. */
  brandFromUrl: z.string().url().max(2048).optional(),
  css: z
    .string()
    .max(50_000)
    .refine((s) => !CSS_TAG_ESCAPE.test(s), {
      message: 'css must not contain <style>, </style>, <script>, or </script>',
    })
    .optional(),
});

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/documents', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const { markdown, title, format, landscape, theme, css } = parsed.data;
    const userId = req.user!.id;

    if (req.user!.credits <= 0) {
      return reply.code(402).send({ error: 'no_credits' });
    }

    // Resolve brand kit. Three sources, in order:
    //   1. brandFromUrl  → detect (cached); becomes the base
    //   2. brandKit string → load saved kit; overlays/replaces the base
    //   3. brandKit object → inline overrides; overlays whatever's there
    // Anything explicitly set in a later step wins.
    let brandKit: BrandKit | undefined;
    let resolvedTheme: ThemeName | undefined = theme;
    let resolvedCss: string | undefined = css;

    if (parsed.data.brandFromUrl) {
      try {
        const detected = await detectBrandKitCached(parsed.data.brandFromUrl);
        brandKit = {
          logoUrl: detected.logoUrl,
          primaryColor: detected.primaryColor,
          fontStyle: detected.fontStyle,
          fontFamily: detected.fontFamily,
          headingFontFamily: detected.headingFontFamily,
        };
      } catch (err) {
        if (err instanceof UrlValidationError) {
          return reply.code(400).send({ error: 'invalid_brand_from_url', reason: err.reason });
        }
        req.log.warn({ err, url: parsed.data.brandFromUrl }, 'brand_from_url_detect_failed');
        return reply.code(502).send({
          error: 'brand_from_url_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (typeof parsed.data.brandKit === 'string') {
      const ref = parsed.data.brandKit;
      const saved = await prisma.brandKit.findFirst({
        where: {
          userId,
          OR: [{ id: ref }, { name: ref }],
        },
      });
      if (!saved) {
        return reply.code(404).send({ error: 'brand_kit_not_found', ref });
      }
      const savedKit: BrandKit = {
        logoUrl: saved.logoUrl ?? undefined,
        primaryColor: saved.primaryColor ?? undefined,
        accentColor: saved.accentColor ?? undefined,
        fontStyle: (saved.fontStyle as BrandKit['fontStyle']) ?? undefined,
        fontFamily: saved.fontFamily ?? undefined,
        headingFontFamily: saved.headingFontFamily ?? undefined,
        density: (saved.density as BrandKit['density']) ?? undefined,
      };
      // Saved kit replaces any URL-detected base (explicit caller intent
      // wins over auto-detection).
      brandKit = savedKit;
      // Brand kit's baseTheme wins when caller didn't specify one explicitly.
      if (!theme && saved.baseTheme) {
        resolvedTheme = saved.baseTheme as ThemeName;
      }
      // Prepend saved customCss before per-request css so the request can override.
      if (saved.customCss) {
        resolvedCss = [saved.customCss, css].filter(Boolean).join('\n\n');
      }
    } else if (parsed.data.brandKit) {
      // Inline kit overlays on top of whatever's already set (e.g. detected
      // from URL) — only non-empty fields override.
      const overlay = parsed.data.brandKit;
      brandKit = {
        logoUrl: overlay.logoUrl ?? brandKit?.logoUrl,
        primaryColor: overlay.primaryColor ?? brandKit?.primaryColor,
        accentColor: overlay.accentColor ?? brandKit?.accentColor,
        fontStyle: overlay.fontStyle ?? brandKit?.fontStyle,
        fontFamily: overlay.fontFamily ?? brandKit?.fontFamily,
        headingFontFamily: overlay.headingFontFamily ?? brandKit?.headingFontFamily,
        density: overlay.density ?? brandKit?.density,
      };
    }

    const document = await prisma.document.create({
      data: { userId, status: 'pending', title },
    });

    // Inline the logo as a data URL so Playwright's header context renders it
    // deterministically (no cross-origin / load-timing flakes). Validate that
    // the URL points to a public address first — otherwise the inline-image
    // fetch is an SSRF probe into our internal network.
    let renderKit = brandKit;
    if (brandKit?.logoUrl) {
      try {
        await assertPublicUrl(brandKit.logoUrl);
      } catch (err) {
        if (err instanceof UrlValidationError) {
          return reply.code(400).send({
            error: 'invalid_logo_url',
            reason: err.reason,
          });
        }
        throw err;
      }
      const inlined = await inlineImage(brandKit.logoUrl);
      if (inlined) renderKit = { ...brandKit, logoUrl: inlined };
    }

      try {
      const html = await markdownToHtml(markdown, { title, theme: resolvedTheme, brandKit: renderKit, css: resolvedCss });
      const headerHtml = renderKit ? buildHeaderHtml(renderKit, title) : undefined;
      const footerHtml = renderKit ? buildFooterHtml(renderKit) : undefined;
      const margin = renderKit ? HEADER_FOOTER_MARGIN : undefined;
      const { buffer, renderTimeMs } = await htmlToPdf(html, { format, landscape, headerHtml, footerHtml, margin });
      const pages = await countPdfPages(buffer);

      if (pages > env.MAX_PAGES_PER_RENDER) {
        await prisma.document.update({
          where: { id: document.id },
          data: { status: 'failed', errorMsg: `pages_exceeded:${pages}` },
        });
        return reply.code(413).send({
          error: 'too_many_pages',
          pages,
          max: env.MAX_PAGES_PER_RENDER,
          message: 'Document exceeds the per-request page cap. Split into smaller documents.',
        });
      }

      const { bytes } = await savePdf(document.id, buffer);

      const { remaining } = await chargeCredits({
        userId,
        documentId: document.id,
        amount: pages,
        reason: 'render',
      });

      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'done', pages, bytes },
      });

      return reply.send({
        id: document.id,
        url: signedUrl(document.id),
        pages,
        bytes,
        creditsUsed: pages,
        creditsRemaining: remaining,
        renderTimeMs,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'failed', errorMsg },
      });

      if (err instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          error: 'insufficient_credits',
          required: err.required,
          available: err.available,
        });
      }
      req.log.error({ err, documentId: document.id }, 'render_failed');
      return reply.code(500).send({ error: 'render_failed', message: errorMsg });
    }
  });
}
