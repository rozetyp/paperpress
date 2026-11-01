import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { clientIp } from './lib/client-ip.js';
import { documentRoutes } from './routes/documents.js';
import { pdfRoutes } from './routes/pdf.js';
import { detectRoutes } from './routes/detect.js';
import { demoRoutes } from './routes/demo.js';
import { mcpRoutes } from './routes/mcp.js';
import { shutdownRenderer } from './render/pdf.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    serializers: {
      // Log the address the rate limits actually key on, not just the socket.
      req: (req) => ({ method: req.method, url: req.url, clientIp: clientIp(req) }),
    },
  },
  bodyLimit: 2 * 1024 * 1024, // 2 MB
});

await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: clientIp,
});

app.get('/health', async () => ({ status: 'ok' }));

// The bare domain is the repo's homepage link, so say what this is and where
// to start instead of 404ing.
app.get('/', async () => ({
  name: 'paperpress',
  description: "Markdown to PDF in any company's brand, detected live from its URL. No API key.",
  docs: 'https://github.com/rozetyp/paperpress',
  mcp: `${env.PUBLIC_BASE_URL}/mcp`,
  try: `curl -X POST ${env.PUBLIC_BASE_URL}/v1/demo -H 'Content-Type: application/json' -d '{"url":"https://stripe.com"}'`,
}));

await app.register(documentRoutes);
await app.register(pdfRoutes);
await app.register(detectRoutes);
await app.register(demoRoutes);
await app.register(mcpRoutes);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await shutdownRenderer();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
