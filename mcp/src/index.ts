#!/usr/bin/env node
// paperpress MCP server.
// Exposes one tool, `generate_pdf`, that POSTs to the paperpress REST API.
// Uses the modern McpServer / registerTool API from @modelcontextprotocol/sdk
// (1.x stable). Tool input is described as a Zod shape; the SDK turns it into
// JSON Schema for the client.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.PAPERPRESS_API_BASE ?? 'https://paperpress-production.up.railway.app';
const API_KEY = process.env.PAPERPRESS_API_KEY;

const server = new McpServer({ name: 'paperpress', version: '0.1.0' });

// Zod shape (NOT z.object(...)) — registerTool wants the raw shape.
const inputShape = {
  markdown: z.string().describe('The markdown content to render. Required.'),
  title: z.string().optional().describe('Optional document title. Appears in PDF metadata.'),
  format: z.enum(['A4', 'Letter', 'Legal']).optional().describe('Page size. Defaults to A4.'),
  landscape: z.boolean().optional().describe('Use landscape orientation. Defaults to false.'),
  theme: z
    .enum(['clean', 'executive', 'academic', 'technical', 'marketing'])
    .optional()
    .describe(
      'Visual theme for the PDF. Pick based on the document type:\n' +
        '• "clean" (default): general reports, balanced serif/sans.\n' +
        '• "executive": board decks, audits — corporate navy, formal.\n' +
        '• "academic": research, papers — serif throughout, justified, dense.\n' +
        '• "technical": API docs, runbooks — sans body, mono headings, teal accent.\n' +
        '• "marketing": pitch decks, client deliverables — big sans, vivid accent.'
    ),
  brandKit: z
    .union([
      z.string(),
      z.object({
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        accentColor: z.string().optional(),
        fontStyle: z.enum(['serif', 'sans', 'mono']).optional(),
        density: z.enum(['compact', 'normal', 'spacious']).optional(),
      }),
    ])
    .optional()
    .describe(
      'Apply a brand kit. Pass a string to reference a saved kit by ID or name (e.g. "default"), or an inline object with any of: primaryColor (hex), accentColor (hex), fontStyle, density, logoUrl.'
    ),
  css: z
    .string()
    .optional()
    .describe(
      'Optional raw CSS appended after the theme + brand kit — escape hatch for one-off overrides. Most callers should not set this.'
    ),
  brandFromUrl: z
    .string()
    .optional()
    .describe(
      'Detect a brand kit (logo, color, font) from this URL and apply it — the one-call brand+render shortcut. 24h-cached per URL. Composes with brandKit: inline brandKit fields override the detected ones.'
    ),
};

server.registerTool(
  'generate_pdf',
  {
    title: 'Generate PDF',
    description:
      'Convert markdown to a branded PDF. Returns a signed URL the user can open. ' +
      'Supports headings, lists, tables, code blocks, blockquotes, and links. ' +
      'Use this whenever the user asks for a PDF, report, or printable document.',
    inputSchema: inputShape,
  },
  async (args) => {
    if (!API_KEY) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              'PAPERPRESS_API_KEY is not set. Register at https://paperpress-production.up.railway.app to get a free key, then add it to your MCP config:\n\n' +
              '  "env": { "PAPERPRESS_API_KEY": "pp_live_..." }',
          },
        ],
      };
    }

    try {
      const res = await fetch(`${API_BASE}/v1/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(args),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          isError: true,
          content: [{ type: 'text', text: `paperpress error ${res.status}: ${text}` }],
        };
      }

      const data = (await res.json()) as {
        id: string;
        url: string;
        pages: number;
        creditsUsed: number;
        creditsRemaining: number;
      };

      const pluralPages = data.pages === 1 ? '' : 's';
      const pluralCredits = data.creditsUsed === 1 ? '' : 's';

      return {
        content: [
          {
            type: 'text',
            text:
              `✓ PDF generated (${data.pages} page${pluralPages}, ` +
              `${data.creditsUsed} credit${pluralCredits} used, ` +
              `${data.creditsRemaining} remaining).\n\n` +
              `URL: ${data.url}\n` +
              `Document ID: ${data.id}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `Network error contacting paperpress: ${msg}` }],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
