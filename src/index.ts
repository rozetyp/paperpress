import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { documentRoutes } from './routes/documents.js';
import { pdfRoutes } from './routes/pdf.js';
import { detectRoutes } from './routes/detect.js';
import { demoRoutes } from './routes/demo.js';
import { mcpRoutes } from './routes/mcp.js';
import { shutdownRenderer } from './render/pdf.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  bodyLimit: 2 * 1024 * 1024, // 2 MB
  // Behind Railway's edge proxy: without this, req.ip is the proxy's address
  // and every per-IP limit becomes one bucket shared by all callers. Trusting
  // exactly one hop takes the address the proxy appended to X-Forwarded-For,
  // not a client-supplied one.
  trustProxy: 1,
});

await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

app.get('/health', async () => ({ status: 'ok' }));

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
