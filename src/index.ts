import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { accountRoutes } from './routes/account.js';
import { pdfRoutes } from './routes/pdf.js';
import { brandKitRoutes } from './routes/brand-kits.js';
import { demoRoutes } from './routes/demo.js';
import { adminRoutes } from './routes/admin.js';
import { shutdownRenderer } from './render/pdf.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  bodyLimit: 2 * 1024 * 1024, // 2 MB
});

await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7).trim();
    return req.ip;
  },
});

app.get('/health', async () => ({ status: 'ok' }));

await app.register(authRoutes);
await app.register(documentRoutes);
await app.register(accountRoutes);
await app.register(pdfRoutes);
await app.register(brandKitRoutes);
await app.register(demoRoutes);
await app.register(adminRoutes);

// Static landing page. Registered last so API routes win for exact matches;
// anything else under "/" falls through to landing/.
const __dirname = dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'landing'),
  prefix: '/',
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await shutdownRenderer();
  await prisma.$disconnect();
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
