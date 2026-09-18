import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { env } from '../env.js';

// Streamable HTTP MCP endpoint — the modern (non-deprecated) MCP transport,
// hosted directly by this same process. Lets any MCP client add this server
// by URL alone: no npm install, no npx, no local build. One tool,
// `generate_pdf`, mirroring the stdio MCP package in mcp/ but reached over
// HTTP instead of a locally-spawned process.
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

function buildServer(authHeader: string | undefined): McpServer {
  const server = new McpServer({ name: 'paperpress', version: '0.1.0' });

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
      if (!authHeader) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'No Authorization header on this MCP request. Add an API key: ' +
                'configure your client to send "Authorization: Bearer pp_live_..." ' +
                `(register at ${env.PUBLIC_BASE_URL}).`,
            },
          ],
        };
      }

      try {
        const res = await fetch(`http://127.0.0.1:${env.PORT}/v1/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
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

  return server;
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mcp', async (req, reply) => {
    const server = buildServer(req.headers.authorization);
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
