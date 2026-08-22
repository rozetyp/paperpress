import type { FastifyInstance } from 'fastify';
import { readPdf, verifySignature } from '../lib/storage.js';
import { prisma } from '../lib/prisma.js';

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/pdf/:id',
    async (req, reply) => {
      const { id } = req.params;
      const exp = Number(req.query.exp);
      const sig = req.query.sig ?? '';

      if (!verifySignature(id, exp, sig)) {
        return reply.code(403).send({ error: 'invalid_signature' });
      }

      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc || doc.status !== 'done') {
        return reply.code(404).send({ error: 'not_found' });
      }

      try {
        const buf = await readPdf(id);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename="${id}.pdf"`);
        return reply.send(buf);
      } catch {
        return reply.code(404).send({ error: 'pdf_missing' });
      }
    }
  );
}
