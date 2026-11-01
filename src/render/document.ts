import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { markdownToHtml } from './markdown.js';
import { htmlToPdf, countPdfPages } from './pdf.js';
import { detectBrandKitCached } from './detect.js';
import type { BrandKit } from './themes/index.js';
import { buildHeaderHtml, buildFooterHtml, HEADER_FOOTER_MARGIN } from './themes/header-footer.js';
import { savePdf, signedUrl } from '../lib/storage.js';
import { inlineImage } from '../lib/inline-image.js';
import { assertPublicUrl, UrlValidationError } from '../lib/url-fetch.js';
import { env } from '../env.js';

// Markdown → branded PDF, shared by POST /v1/documents and the MCP
// generate_pdf tool so both validate and render identically.

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

export const RenderInput = z.object({
  markdown: z.string().min(1).max(500_000),
  title: z.string().max(200).optional(),
  format: z.enum(['A4', 'Letter', 'Legal']).optional(),
  landscape: z.boolean().optional(),
  theme: z.enum(['clean', 'executive', 'academic', 'technical', 'marketing']).optional(),
  brandKit: InlineBrandKit.optional(),
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
export type RenderInput = z.infer<typeof RenderInput>;

export type RenderedDocument = {
  id: string;
  url: string;
  pages: number;
  bytes: number;
  renderTimeMs: number;
};

/** A rejection the caller should see as-is: HTTP status + JSON body. */
export class RenderError extends Error {
  constructor(
    public status: number,
    public body: { error: string } & Record<string, unknown>,
  ) {
    super(body.error);
  }
}

export async function renderDocument(input: RenderInput): Promise<RenderedDocument> {
  const { markdown, title, format, landscape, theme, css } = input;

  // Detected kit (if any) is the base; inline fields overlay it.
  let brandKit: BrandKit | undefined;
  if (input.brandFromUrl) {
    try {
      const detected = await detectBrandKitCached(input.brandFromUrl);
      brandKit = {
        logoUrl: detected.logoUrl,
        primaryColor: detected.primaryColor,
        fontStyle: detected.fontStyle,
        fontFamily: detected.fontFamily,
        headingFontFamily: detected.headingFontFamily,
      };
    } catch (err) {
      if (err instanceof UrlValidationError) {
        throw new RenderError(400, { error: 'invalid_brand_from_url', reason: err.reason });
      }
      throw new RenderError(502, {
        error: 'brand_from_url_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (input.brandKit) {
    const overlay = input.brandKit;
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
        throw new RenderError(400, { error: 'invalid_logo_url', reason: err.reason });
      }
      throw err;
    }
    const inlined = await inlineImage(brandKit.logoUrl);
    if (inlined) renderKit = { ...brandKit, logoUrl: inlined };
  }

  const html = await markdownToHtml(markdown, { title, theme, brandKit: renderKit, css });
  const headerHtml = renderKit ? buildHeaderHtml(renderKit, title) : undefined;
  const footerHtml = renderKit ? buildFooterHtml(renderKit) : undefined;
  const margin = renderKit ? HEADER_FOOTER_MARGIN : undefined;
  const { buffer, renderTimeMs } = await htmlToPdf(html, { format, landscape, headerHtml, footerHtml, margin });
  const pages = await countPdfPages(buffer);

  if (pages > env.MAX_PAGES_PER_RENDER) {
    throw new RenderError(413, {
      error: 'too_many_pages',
      pages,
      max: env.MAX_PAGES_PER_RENDER,
      message: 'Document exceeds the per-request page cap. Split into smaller documents.',
    });
  }

  const id = randomUUID();
  const { bytes } = await savePdf(id, buffer);
  return { id, url: signedUrl(id), pages, bytes, renderTimeMs };
}
