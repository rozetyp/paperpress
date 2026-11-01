import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { RenderInput, RenderError, renderDocument } from '../render/document.js';
import { takeRenderToken } from '../lib/render-limit.js';

// Streamable HTTP MCP endpoint — the modern (non-deprecated) MCP transport,
// hosted directly by this same process. Lets any MCP client add this server
// by URL alone: no npm install, no npx, no local build, no API key. One tool,
// `generate_pdf`, sharing renderDocument() and the per-IP render budget with
// POST /v1/documents.
//
// Stateless: a fresh McpServer + transport per request (sessionIdGenerator:
// undefined). This is a single stateless tool call, not a long-lived
// streaming session, so there's nothing worth persisting between requests.
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
    .object({
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      fontStyle: z.enum(['serif', 'sans', 'mono']).optional(),
      density: z.enum(['compact', 'normal', 'spacious']).optional(),
    })
    .optional()
    .describe(
      'Apply a brand kit inline, with any of: primaryColor (hex), accentColor (hex), fontStyle, density, logoUrl.'
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

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

function buildServer(ip: string): McpServer {
  const server = new McpServer({ name: 'paperpress', version: '0.2.0' });

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
      // The MCP schema above is deliberately loose (it's what the model sees);
      // RenderInput is the real validation, same as POST /v1/documents.
      const parsed = RenderInput.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid input: ${JSON.stringify(parsed.error.flatten())}`);
      }

      const token = takeRenderToken(ip);
      if (!token.ok) {
        return errorResult(`Rate limited: try again in ${token.retryAfterSec}s.`);
      }

      try {
        const doc = await renderDocument(parsed.data);
        const plural = doc.pages === 1 ? '' : 's';
        return {
          content: [
            {
              type: 'text',
              text: `✓ PDF generated (${doc.pages} page${plural}).\n\nURL: ${doc.url}\nDocument ID: ${doc.id}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof RenderError) {
          return errorResult(`paperpress error ${err.status}: ${JSON.stringify(err.body)}`);
        }
        return errorResult(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mcp', async (req, reply) => {
    const server = buildServer(req.ip);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.hijack(); // transport has already written the response directly to reply.raw
  });
}
