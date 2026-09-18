// Academic — papers, research notes. Serif throughout, dense, justified body.
// Centered H1, small caps section numbers feel via h2 styling.
export const academicTheme = `
:root {
  --pp-accent: #1a1a1a;
  --pp-accent-soft: rgba(0, 0, 0, 0.04);
  --pp-font-body: 'EB Garamond', 'Source Serif Pro', 'Times New Roman', Georgia, serif;
  --pp-font-heading: 'EB Garamond', 'Source Serif Pro', 'Times New Roman', Georgia, serif;
  --pp-size-body: 10.5pt;
  --pp-line-height: 1.45;
  --pp-h1-size: 1.55em;
  --pp-h2-size: 1.22em;
  --pp-h3-size: 1.08em;
  --pp-spacing-scale: 0.9;
}

p {
  text-align: justify;
  hyphens: auto;
}

h1 {
  text-align: center;
  font-weight: 600;
  margin-bottom: 1em;
}

h2 {
  font-weight: 600;
  letter-spacing: 0.02em;
}

h3 {
  font-style: italic;
  font-weight: 500;
}

blockquote {
  background: transparent;
  border-left-color: #9ca3af;
  font-size: 0.95em;
  font-style: italic;
}

.footnotes {
  font-size: 0.82em;
  line-height: 1.4;
}
`;
