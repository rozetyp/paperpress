import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';
import { composeTheme, type ThemeName, type BrandKit } from './themes/index.js';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
  .use(rehypeStringify);

export type MarkdownOptions = {
  title?: string;
  theme?: ThemeName;
  brandKit?: BrandKit;
  /** Raw CSS appended after theme + brand kit — escape hatch for fine-grained overrides. */
  css?: string;
};

export async function markdownToHtml(markdown: string, options: MarkdownOptions = {}): Promise<string> {
  const file = await processor.process(markdown);
  const body = String(file);

  const escapedTitle = (options.title ?? 'Document')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const css = composeTheme({
    theme: options.theme,
    brandKit: options.brandKit,
    customCss: options.css,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapedTitle}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}
