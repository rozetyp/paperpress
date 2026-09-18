# @paperpress/mcp

MCP server for [paperpress](https://github.com/rozetyp/paperpress) — wraps `/v1/documents` as one `generate_pdf` tool.

**Not published to npm** — this is reference code, part of a portfolio piece, not an installable package. There's no `npx -y @paperpress/mcp` that works. If you want to run it: clone the repo, `cd mcp && npm install && npm run build`, then point an MCP client's `command`/`args` at `node` and the built `dist/index.js` directly, with `PAPERPRESS_API_KEY` (and optionally `PAPERPRESS_API_BASE`, which defaults to the live demo at `https://paperpress-production.up.railway.app`) in `env`.

## Tool

### `generate_pdf`

Convert markdown to a branded PDF. Returns a signed URL.

Arguments:
- `markdown` (string, required) — the markdown content
- `title` (string, optional) — document title
- `format` (`A4` | `Letter` | `Legal`, optional) — page size, default `A4`
- `landscape` (boolean, optional) — orientation, default `false`
- `theme` (`clean` | `executive` | `academic` | `technical` | `marketing`, optional) — visual theme, default `clean`
- `brandKit` (string | object, optional) — a saved kit's name/ID, or an inline object with any of `logoUrl`, `primaryColor`, `accentColor`, `fontStyle` (`serif` | `sans` | `mono`), `density` (`compact` | `normal` | `spacious`)
- `css` (string, optional) — raw CSS appended after the theme + brand kit; escape hatch for one-off overrides
- `brandFromUrl` (string, optional) — detect a brand kit from this URL and apply it in the same call. 24h-cached. Composes with `brandKit` (inline fields override detected ones).

Example agent prompt:
> "Write a one-page SEO audit for example.com and generate it as a PDF I can share with the client."

The agent generates the markdown, calls `generate_pdf`, and returns the URL.

## Credits

- 1 credit = 1 page
- No payment processing exists anywhere in this project — credits are just a counter in Postgres.

## License

MIT
