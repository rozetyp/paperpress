// Pre-render docs/index.md → landing/docs/index.html at Docker build time so the
// single docs page is served as a static file by @fastify/static — crawlable,
// no runtime render cost. The remark/rehype pipeline matches the one the PDF
// renderer uses, so prose styling and code blocks read consistent with the
// product itself.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';

const SOURCE = 'docs/index.md';
const OUT_DIR = 'landing/docs';
const OUT_FILE = `${OUT_DIR}/index.html`;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
  .use(rehypeStringify, { allowDangerousHtml: true });

function shell(title: string, description: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - paperpress</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#1c1814">
<link rel="canonical" href="https://paperpress-production.up.railway.app/docs/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="nav">
  <a class="brand" href="/" aria-label="paperpress home">
    <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="14" y2="13"/>
      <line x1="8" y1="17" x2="14" y2="17"/>
    </svg>
    <span>paperpress</span>
  </a>
  <nav class="nav-links">
    <a href="/#how">How it works</a>
    <a href="/#themes">Themes</a>
    <a href="/#install">Install</a>
    <a href="/#pricing">Pricing</a>
    <a href="/docs/">Docs</a>
    <a href="/about.html">About</a>
  </nav>
</header>
<main class="doc">
<article>
${bodyHtml}
</article>
</main>
<footer>
  <div class="footer-inner">
    <a class="brand" href="/">
      <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="14" y2="13"/>
        <line x1="8" y1="17" x2="14" y2="17"/>
      </svg>
      <span>paperpress</span>
    </a>
    <nav class="footer-nav">
      <a href="/about.html">About</a>
      <a href="/docs/">Docs</a>
      <a href="/#install">Install MCP</a>
      <a href="/docs/#api-reference">API</a>
      <a href="mailto:hello@paperpress.dev">Contact</a>
    </nav>
  </div>
  <p class="footer-fineprint">© paperpress · A PDF API for AI agents.</p>
</footer>
</body>
</html>
`;
}

function titleFromMd(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function descriptionFromMd(md: string, fallback: string): string {
  const lines = md.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('<')) continue;
    return line.replace(/[*_`[\]]/g, '').slice(0, 160);
  }
  return fallback;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const md = await readFile(SOURCE, 'utf-8');
  const title = titleFromMd(md, 'Docs');
  const description = descriptionFromMd(md, 'paperpress documentation');
  const html = String(await processor.process(md));
  await writeFile(OUT_FILE, shell(title, description, html));
  console.log(`built ${OUT_FILE} from ${SOURCE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
