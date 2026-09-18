// Marketing — pitch decks, audit deliverables, client-facing reports.
// Big sans display type, vivid coral accent, generous whitespace, strong block quotes.
export const marketingTheme = `
:root {
  --pp-accent: #ea580c;
  --pp-accent-soft: rgba(234, 88, 12, 0.08);
  --pp-text: #111827;
  --pp-font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --pp-font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --pp-size-body: 11.5pt;
  --pp-line-height: 1.6;
  --pp-spacing-scale: 1.35;
  --pp-h1-size: 2.6em;
  --pp-h2-size: 1.8em;
  --pp-h3-size: 1.3em;
}

h1 {
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

h2 {
  font-weight: 700;
  letter-spacing: -0.02em;
}

h3 {
  font-weight: 600;
  letter-spacing: -0.01em;
}

strong { color: var(--pp-accent); font-weight: 600; }

blockquote {
  border-left-width: 4px;
  font-size: 1.1em;
  font-weight: 500;
  color: var(--pp-text);
  padding: 1em 1.4em;
  font-style: normal;
}

table { font-size: 1em; }
th { font-size: 0.85em; letter-spacing: 0.04em; text-transform: uppercase; }
`;
