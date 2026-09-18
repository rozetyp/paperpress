// Base stylesheet. Defines CSS custom properties and the element selectors
// that consume them. Themes override the variables. Brand kits override
// the variables again. Raw user CSS is appended last.
//
// Cascade order at render time:
//   base  →  theme  →  brand kit  →  user css

export const baseCss = `
@page {
  margin: var(--pp-page-margin, 18mm 16mm 18mm 16mm);
}

:root {
  /* colors */
  --pp-text: #1a1a1a;
  --pp-muted: #6b7280;
  --pp-rule: #e5e7eb;
  --pp-accent: #0a2540;
  --pp-accent-soft: rgba(10, 37, 64, 0.06);
  --pp-code-bg: #f6f8fa;
  --pp-code-fg: #1f2937;
  --pp-th-bg: #f9fafb;

  /* fonts */
  --pp-font-body: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
  --pp-font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --pp-font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* type scale */
  --pp-size-body: 11pt;
  --pp-line-height: 1.55;
  --pp-h1-size: 1.9em;
  --pp-h2-size: 1.45em;
  --pp-h3-size: 1.2em;
  --pp-h4-size: 1.05em;

  /* spacing scale (themes can compress or expand) */
  --pp-spacing-scale: 1;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  color: var(--pp-text);
  font-family: var(--pp-font-body);
  font-size: var(--pp-size-body);
  line-height: var(--pp-line-height);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--pp-font-heading);
  color: var(--pp-accent);
  line-height: 1.25;
  margin: calc(1.4em * var(--pp-spacing-scale)) 0 0.5em;
  page-break-after: avoid;
  break-after: avoid;
}
h1 { font-size: var(--pp-h1-size); margin-top: 0; letter-spacing: -0.01em; }
h2 { font-size: var(--pp-h2-size); }
h3 { font-size: var(--pp-h3-size); }
h4 { font-size: var(--pp-h4-size); }

p {
  margin: 0 0 calc(0.85em * var(--pp-spacing-scale));
  orphans: 3;
  widows: 3;
}

a { color: var(--pp-accent); text-decoration: underline; }
strong { font-weight: 600; }

ul, ol { margin: 0 0 1em 1.4em; padding: 0; }
li { margin-bottom: 0.3em; }
li > p { margin-bottom: 0.3em; }

blockquote {
  margin: 1em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--pp-accent);
  background: var(--pp-accent-soft);
  color: var(--pp-muted);
  page-break-inside: avoid;
  break-inside: avoid;
}

hr {
  border: 0;
  border-top: 1px solid var(--pp-rule);
  margin: 1.6em 0;
}

code {
  font-family: var(--pp-font-mono);
  font-size: 0.9em;
  background: var(--pp-code-bg);
  color: var(--pp-code-fg);
  padding: 0.12em 0.35em;
  border-radius: 3px;
}

pre {
  background: var(--pp-code-bg);
  color: var(--pp-code-fg);
  padding: 0.9em 1em;
  border-radius: 4px;
  overflow-x: auto;
  page-break-inside: avoid;
  break-inside: avoid;
  font-size: 0.9em;
}
pre code { background: transparent; padding: 0; color: inherit; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.95em;
  page-break-inside: avoid;
  break-inside: avoid;
}
thead { display: table-header-group; }
th, td {
  border-bottom: 1px solid var(--pp-rule);
  text-align: left;
  padding: 0.5em 0.7em;
  vertical-align: top;
}
th {
  background: var(--pp-th-bg);
  font-weight: 600;
  color: var(--pp-accent);
}
tr { page-break-inside: avoid; break-inside: avoid; }

img, figure, svg, canvas {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}
figure { margin: 1em 0; }
figure figcaption {
  font-size: 0.85em;
  color: var(--pp-muted);
  text-align: center;
  margin-top: 0.3em;
}

/* heading anchors auto-injected by rehype-autolink-headings */
h1 a, h2 a, h3 a, h4 a, h5 a, h6 a {
  color: inherit;
  text-decoration: none;
}

/* footnotes */
sup a { text-decoration: none; }
.footnotes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--pp-rule);
  font-size: 0.85em;
  color: var(--pp-muted);
}
`;
