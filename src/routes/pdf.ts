import type { FastifyInstance } from 'fastify';
import { readPdf, verifySignature } from '../lib/storage.js';

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/pdf/:id',
    async (req, reply) => {
      const { id } = req.params;
      const exp = Number(req.query.exp);
      const sig = req.query.sig ?? '';

      // The signature covers the id, so only ids this server minted get past
      // here — which is also what keeps `id` safe to use as a filename.
      if (!verifySignature(id, exp, sig)) {
        return reply.code(403).send({ error: 'invalid_signature' });
      }

      try {
        const buf = await readPdf(id);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename="${id}.pdf"`);
        return reply.send(buf);
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    }
  );
}
