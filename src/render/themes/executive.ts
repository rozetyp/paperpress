// Executive — corporate, formal, generous whitespace.
// Deep navy accent. Uppercase H1 with letter-spacing. Subtle rule under H2.
export const executiveTheme = `
:root {
  --pp-accent: #003366;
  --pp-accent-soft: rgba(0, 51, 102, 0.07);
  --pp-text: #0a0a0a;
  --pp-spacing-scale: 1.18;
  --pp-h1-size: 1.7em;
}

h1 {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  padding-bottom: 0.4em;
  border-bottom: 2px solid var(--pp-accent);
}

h2 {
  letter-spacing: 0.01em;
  font-weight: 600;
  padding-bottom: 0.22em;
  border-bottom: 1px solid var(--pp-rule);
}

h3 {
  font-style: italic;
  font-weight: 500;
}

blockquote {
  font-style: italic;
  font-size: 1.04em;
  border-left-width: 4px;
}
`;
