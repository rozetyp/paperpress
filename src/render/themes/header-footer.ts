// Generate Playwright headerTemplate + footerTemplate HTML from a brand kit.
//
// Playwright's header/footer is rendered in an isolated context with NO access
// to the document's CSS. All styles must be inline. Playwright also exposes
// magic <span class="..."> placeholders that get auto-populated:
//   .pageNumber  — current page
//   .totalPages  — total pages
//   .date        — formatted date
//   .title       — document <title>
//   .url         — document location

import { usableAsText, type BrandKit } from './brand-kit.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NEUTRAL_INK = '#374151';
const NEUTRAL_INK_SOFT = '#9ca3af';

// Playwright's headerTemplate is finicky:
//   • flexbox often silently drops children → use <table> for layout
//   • mm units render inconsistently → use px
//   • body has font-size: 0 by default → set explicit font-size everywhere
//   • -webkit-print-color-adjust: exact is required for colored text/bg
export function buildHeaderHtml(kit: BrandKit | undefined, title: string | undefined): string {
  if (!kit) return '';
  const ink = kit.primaryColor && usableAsText(kit.primaryColor) ? kit.primaryColor : NEUTRAL_INK;
  const logo = kit.logoUrl
    ? `<img src="${escapeHtml(kit.logoUrl)}" style="height: 18px; width: auto; max-width: 60px; vertical-align: middle;">`
    : '';
  const t = title ? escapeHtml(title) : '';
  const titleSpan = t
    ? `<span style="vertical-align: middle; margin-left: ${kit.logoUrl ? '8px' : '0'}; font-weight: 500;">${t}</span>`
    : '';
  return `<div style="font-size: 9px; color: ${ink}; width: 100%; padding: 0 60px; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="text-align: left; vertical-align: middle;">${logo}${titleSpan}</td>
        <td style="text-align: right; vertical-align: middle; color: ${NEUTRAL_INK_SOFT};"><span class="date"></span></td>
      </tr>
    </table>
  </div>`;
}

export function buildFooterHtml(kit: BrandKit | undefined): string {
  if (!kit) return '';
  const ink = kit.primaryColor && usableAsText(kit.primaryColor) ? kit.primaryColor : NEUTRAL_INK;
  return `<div style="font-size: 9px; color: ${NEUTRAL_INK_SOFT}; width: 100%; padding: 0 60px; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="text-align: left; vertical-align: middle; color: ${ink}; opacity: 0.7;">paperpress</td>
        <td style="text-align: right; vertical-align: middle;"><span class="pageNumber"></span> / <span class="totalPages"></span></td>
      </tr>
    </table>
  </div>`;
}

// Margins big enough to clear the inline header/footer without crowding content.
// Without a brand kit (no header/footer), keep the slimmer base margins.
export const HEADER_FOOTER_MARGIN = {
  top: '22mm',
  right: '16mm',
  bottom: '20mm',
  left: '16mm',
};
