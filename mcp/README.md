# @paperpress/mcp

MCP server for [paperpress](https://github.com/rozetyp/paperpress) — turn markdown into branded PDFs from inside Claude Desktop, Cursor, or any MCP-compatible AI agent.

## Install

Add to your MCP config (`~/.claude/mcp.json` for Claude Desktop, or your client's equivalent):

```json
{
  "mcpServers": {
    "paperpress": {
      "command": "npx",
      "args": ["-y", "@paperpress/mcp"],
      "env": {
        "PAPERPRESS_API_KEY": "pp_live_..."
      }
    }
  }
}
```

Get a free API key by POSTing your email to `/auth/register` on the reference deployment (see the [main README](../README.md#local-dev)), or self-host and point at your own instance.

`PAPERPRESS_API_BASE` is also read from the environment if you need to point at a different host; it defaults to the hosted reference deployment, `https://paperpress-production.up.railway.app`.

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
- Free tier and rate limits are set by whichever instance you point at (see `PAPERPRESS_API_BASE`) — self-hosted instances configure this themselves (`FREE_TIER_CREDITS` env var).

## License

MIT
