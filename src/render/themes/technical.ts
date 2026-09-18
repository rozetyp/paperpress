// Technical — API docs, runbooks, engineering reports.
// Sans body, mono headings, teal accent, emphasized code blocks.
export const technicalTheme = `
:root {
  --pp-accent: #0d9488;
  --pp-accent-soft: rgba(13, 148, 136, 0.08);
  --pp-text: #0f172a;
  --pp-font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --pp-font-heading: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --pp-size-body: 10.5pt;
  --pp-line-height: 1.5;
  --pp-spacing-scale: 0.95;
  --pp-h1-size: 1.7em;
  --pp-h2-size: 1.3em;
  --pp-h3-size: 1.08em;
  --pp-th-bg: rgba(13, 148, 136, 0.08);
}

h1, h2, h3 {
  letter-spacing: -0.01em;
  font-weight: 600;
}

h1::before { content: '# '; color: var(--pp-muted); font-weight: 400; }
h2::before { content: '## '; color: var(--pp-muted); font-weight: 400; }
h3::before { content: '### '; color: var(--pp-muted); font-weight: 400; }

pre {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 0.85em;
}
pre code { color: inherit; }

code {
  background: var(--pp-accent-soft);
  color: var(--pp-accent);
}

table { font-size: 0.9em; }

blockquote {
  border-left-width: 3px;
  border-radius: 0 3px 3px 0;
}
`;
