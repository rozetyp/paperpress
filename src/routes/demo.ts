// Anonymous public demo endpoint. Powers the "paste a URL, see your brand"
// widget on the landing page.
//
// Tight per-IP rate limit (overrides the global limit) so the widget can't
// be abused as a free brand-scraping API or a Chromium DoS amplifier. The
// detect side reuses the same 24h cache as the authenticated endpoint, so
// popular URLs only pay the navigation cost once per day across all callers.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { detectBrandKitCached } from '../render/detect.js';
import { markdownToHtml } from '../render/markdown.js';
import { htmlToPdf } from '../render/pdf.js';
import { savePdf, signedUrl } from '../lib/storage.js';
import { inlineImage } from '../lib/inline-image.js';
import { assertPublicUrl, UrlValidationError } from '../lib/url-fetch.js';
import {
  buildHeaderHtml,
  buildFooterHtml,
  HEADER_FOOTER_MARGIN,
} from '../render/themes/header-footer.js';
import type { BrandKit } from '../render/themes/index.js';

const DEMO_USER_EMAIL = 'demo@paperpress.internal';
const DEMO_TITLE = 'Q4 Field Performance';

// Inlined so the demo doesn't depend on samples/ being copied into the
// Docker image. Edit here when the template needs to change.
const DEMO_MARKDOWN = `# Q4 Field Performance

**Prepared by:** Operations · **Date:** December 31, 2025

## Executive Summary

Field operations delivered **+14% YoY** revenue growth in Q4 2025, with notable strength in the North Sea and Permian basin. Three high-leverage initiatives are recommended for Q1 to sustain momentum.

## Key Metrics

| Metric | Q3 2025 | Q4 2025 | Δ |
|---|---|---|---|
| Active rigs | 312 | 341 | **+9%** |
| Operating margin | 18.2% | 19.4% | **+120 bps** |
| Backlog (USD bn) | 12.1 | 13.6 | **+12%** |
| Customer NPS | 41 | 47 | **+6** |

## Recommendations

1. **Expand Permian crew capacity by 18%** to absorb pent-up demand from independent operators. Estimated incremental revenue: $42M annualized.
2. **Accelerate the digital-twin rollout** to the top 20 accounts. Customer pilots show 22% reduction in non-productive time.
3. **Renew the EU framework contract** before the Q1 cutoff. Legal review is the gating step; current draft is with counsel.

> *This is a paperpress demo. The markdown above was rendered into a branded PDF using brand colors, logo, and typeface detected automatically from the URL you provided.*
`;

let cachedDemoUserId: string | null = null;
async function getDemoUserId(): Promise<string> {
  if (cachedDemoUserId) return cachedDemoUserId;
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: { email: DEMO_USER_EMAIL, credits: 0 },
  });
  cachedDemoUserId = user.id;
  return user.id;
}

const Body = z.object({ url: z.string().min(1).max(2048) });

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/demo
  //   body: { url }
  //   response: { detected, pdf: { url, bytes }, elapsedMs }
  //
  // Detection uses the same 24h cache as the authenticated path. Rendering
  // skips chargeCredits — demo doesn't bill — and attributes the Document
  // rows to a system "demo" user so admin views still see the traffic.
  app.post(
    '/v1/demo',
    {
      // Per-IP, much tighter than the global 60/min. Caps the worst case
      // when the cache misses and a fresh Chromium navigation runs.
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
        return reply
          .code(400)
          .send({ error: 'invalid_body', details: parsed.error.flatten() });
      }

      const t0 = Date.now();

      // 1. Detect (cached, public-URL guarded).
      let detected;
      try {
        detected = await detectBrandKitCached(parsed.data.url);
      } catch (err) {
        if (err instanceof UrlValidationError) {
          return reply.code(400).send({ error: err.reason });
        }
        req.log.warn({ err, url: parsed.data.url }, 'demo_detect_failed');
        return reply.code(502).send({
          error: 'detection_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const brandKit: BrandKit = {
        logoUrl: detected.logoUrl,
        primaryColor: detected.primaryColor,
        fontStyle: detected.fontStyle,
        fontFamily: detected.fontFamily,
        headingFontFamily: detected.headingFontFamily,
      };

      // Inline the logo once before both renders. assertPublicUrl was already
      // run inside detectBrandKitCached, so the URL is known safe.
      let renderKit = brandKit;
      if (brandKit.logoUrl) {
        try {
          await assertPublicUrl(brandKit.logoUrl);
        } catch {
          // Detector returned a non-public logo URL (unlikely after its own
          // checks). Drop the logo silently for the demo so the renders still
          // produce something visible.
          renderKit = { ...brandKit, logoUrl: undefined };
        }
        if (renderKit.logoUrl) {
          const inlined = await inlineImage(renderKit.logoUrl);
          if (inlined) renderKit = { ...renderKit, logoUrl: inlined };
        }
      }

      const userId = await getDemoUserId();
      const markdown = DEMO_MARKDOWN;

      // 2. Render the PDF.
      let pdf: { id: string; url: string; bytes: number } | undefined;
      let pdfError: string | undefined;
      try {
        const html = await markdownToHtml(markdown, {
          title: DEMO_TITLE,
          theme: 'executive',
          brandKit: renderKit,
        });
        const headerHtml = buildHeaderHtml(renderKit, DEMO_TITLE);
        const footerHtml = buildFooterHtml(renderKit);
        const { buffer } = await htmlToPdf(html, {
          format: 'A4',
          headerHtml,
          footerHtml,
          margin: HEADER_FOOTER_MARGIN,
        });
        const doc = await prisma.document.create({
          data: { userId, status: 'done', title: DEMO_TITLE, pages: 1, bytes: buffer.length },
        });
        await savePdf(doc.id, buffer);
        pdf = { id: doc.id, url: signedUrl(doc.id), bytes: buffer.length };
      } catch (err) {
        pdfError = err instanceof Error ? err.message : String(err);
      }

      const out: Record<string, unknown> = { detected, elapsedMs: Date.now() - t0 };
      if (pdf) out.pdf = pdf;
      if (pdfError) out.pdfError = pdfError;
      return reply.send(out);
    },
  );
}
