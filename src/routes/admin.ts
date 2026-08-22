import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { readPdf } from '../lib/storage.js';
import { env } from '../env.js';

// Compare in constant time so the endpoint isn't a timing oracle for the token.
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Token lookup tries three sources, in priority order:
//   1. X-Admin-Token header (CLI / curl)
//   2. HTTP Basic Auth password (browser — so the dashboard can prompt once
//      and the prompt's cached creds get sent on every PDF download)
function extractToken(req: FastifyRequest): string | undefined {
  const headerVal = req.headers['x-admin-token'];
  const direct = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (direct) return direct;

  const auth = req.headers.authorization;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0) return decoded.slice(i + 1);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!env.ADMIN_TOKEN) {
    // No token configured = admin disabled. Return 404 so the route is
    // indistinguishable from an unmounted one.
    reply.code(404).send({ error: 'not_found' });
    return;
  }
  const token = extractToken(req);
  if (!token || !tokenMatches(token, env.ADMIN_TOKEN)) {
    // For browsers (anything that didn't supply the header), challenge with
    // Basic so the password prompt appears. CLI clients won't see this.
    if (req.headers['user-agent']?.toLowerCase().includes('mozilla')) {
      reply.header('WWW-Authenticate', 'Basic realm="paperpress admin"');
      reply.code(401).send('Authentication required');
      return;
    }
    reply.code(404).send({ error: 'not_found' });
    return;
  }
}

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type AdminStats = {
  users: number;
  activeKeys: number;
  documents: number;
  documentsLast24h: number;
  documentsLast7d: number;
  totalPages: number;
  totalBytes: number;
  totalCreditsCharged: number;
};

// Shared by /admin/stats and the /admin/ dashboard so the two views can't
// silently drift out of sync.
async function getAdminStats(): Promise<AdminStats> {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [
    users,
    documents,
    documentsLast24h,
    documentsLast7d,
    pageAgg,
    creditAgg,
    activeKeys,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.document.count(),
    prisma.document.count({ where: { createdAt: { gte: since24h } } }),
    prisma.document.count({ where: { createdAt: { gte: since7d } } }),
    prisma.document.aggregate({
      _sum: { pages: true, bytes: true },
      where: { status: 'done' },
    }),
    prisma.creditTransaction.aggregate({ _sum: { amount: true } }),
    prisma.apiKey.count({
      where: { OR: [{ revokedAt: null }, { revokedAt: { gt: new Date() } }] },
    }),
  ]);

  return {
    users,
    activeKeys,
    documents,
    documentsLast24h,
    documentsLast7d,
    totalPages: pageAgg._sum.pages ?? 0,
    totalBytes: pageAgg._sum.bytes ?? 0,
    totalCreditsCharged: -1 * (creditAgg._sum.amount ?? 0),
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/stats', { preHandler: requireAdmin }, async () => getAdminStats());

  app.get('/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() });
    }
    const { limit, offset } = parsed.data;
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        email: true,
        credits: true,
        createdAt: true,
        _count: { select: { documents: true, apiKeys: true } },
      },
    });
    return { users, limit, offset };
  });

  app.get('/admin/documents', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = ListQuery.extend({
      userId: z.string().optional(),
      status: z.enum(['pending', 'done', 'failed']).optional(),
    }).safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() });
    }
    const { limit, offset, userId, status } = parsed.data;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        pages: true,
        bytes: true,
        errorMsg: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    });
    return { documents, limit, offset };
  });

  // Stream a PDF without needing a signed URL. The admin token is the gate.
  app.get<{ Params: { id: string } }>(
    '/admin/documents/:id/pdf',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
      if (!doc || doc.status !== 'done') return reply.code(404).send({ error: 'not_found' });
      try {
        const buffer = await readPdf(doc.id);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `inline; filename="${doc.id}.pdf"`)
          .send(buffer);
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );

  // HTML dashboard. Server-rendered, zero JS. Browser auths via the Basic
  // password prompt; the cached creds are sent on every PDF link click.
  app.get('/admin/', { preHandler: requireAdmin }, async (_req, reply) => {
    const [
      { users: userCount, documents: docCount, documentsLast24h: last24h, documentsLast7d: last7d, totalPages, totalBytes, totalCreditsCharged: totalCredits, activeKeys },
      docs,
    ] = await Promise.all([
      getAdminStats(),
      prisma.document.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          status: true,
          pages: true,
          bytes: true,
          errorMsg: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    const fmt = (n: number): string => n.toLocaleString('en-US');
    const fmtBytes = (n: number): string => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1024 / 1024).toFixed(2)} MB`;
    };
    const fmtDate = (d: Date): string =>
      d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const esc = (s: string | null | undefined): string =>
      (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const statusBadge = (s: string): string => {
      const cls = s === 'done' ? 'ok' : s === 'failed' ? 'err' : 'pending';
      return `<span class="badge ${cls}">${s}</span>`;
    };

    const rows = docs
      .map(
        (d) => `
        <tr>
          <td class="ts">${fmtDate(d.createdAt)}</td>
          <td>${statusBadge(d.status)}</td>
          <td class="title">${esc(d.title) || '<span class="muted">(untitled)</span>'}</td>
          <td>${esc(d.user.email)}</td>
          <td class="num">${d.pages ?? ''}</td>
          <td class="num">${d.bytes ? fmtBytes(d.bytes) : ''}</td>
          <td>${
            d.status === 'done'
              ? `<a href="/admin/documents/${d.id}/pdf" target="_blank">open</a>`
              : d.errorMsg
                ? `<span class="errmsg" title="${esc(d.errorMsg)}">${esc(d.errorMsg.slice(0, 60))}</span>`
                : ''
          }</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>paperpress admin</title>
<link rel="stylesheet" href="/styles.css">
<style>
  main.admin { max-width: 1180px; padding: 32px 28px 80px; }
  main.admin h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }
  .stat {
    border: 1px solid var(--rule);
    padding: 14px 18px;
    border-radius: 6px;
  }
  .stat label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .stat .v { font-size: 1.3rem; font-weight: 600; }
  table.docs { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.docs th, table.docs td {
    padding: 9px 10px;
    border-bottom: 1px solid var(--rule);
    text-align: left;
    vertical-align: top;
  }
  table.docs th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    background: var(--bg-alt);
    font-weight: 600;
  }
  table.docs td.ts { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); white-space: nowrap; }
  table.docs td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  table.docs td.title { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge.ok { background: #dcfce7; color: #166534; }
  .badge.err { background: #fee2e2; color: #991b1b; }
  .badge.pending { background: #fef3c7; color: #92400e; }
  .errmsg { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #991b1b; font-size: 11px; }
  .muted { color: var(--muted); }
</style>
</head>
<body>
<header class="nav">
  <a class="brand" href="/">paperpress</a>
  <nav>
    <a href="/admin/">Admin</a>
    <a href="/docs/">Docs</a>
  </nav>
</header>
<main class="admin">
  <h1>Admin</h1>
  <div class="stat-row">
    <div class="stat"><label>Users</label><div class="v">${fmt(userCount)}</div></div>
    <div class="stat"><label>Active keys</label><div class="v">${fmt(activeKeys)}</div></div>
    <div class="stat"><label>Documents</label><div class="v">${fmt(docCount)}</div></div>
    <div class="stat"><label>Last 24h</label><div class="v">${fmt(last24h)}</div></div>
    <div class="stat"><label>Last 7d</label><div class="v">${fmt(last7d)}</div></div>
    <div class="stat"><label>Total pages</label><div class="v">${fmt(totalPages)}</div></div>
    <div class="stat"><label>Total bytes</label><div class="v">${fmtBytes(totalBytes)}</div></div>
    <div class="stat"><label>Credits charged</label><div class="v">${fmt(totalCredits)}</div></div>
  </div>
  <table class="docs">
    <thead>
      <tr>
        <th>Created</th>
        <th>Status</th>
        <th>Title</th>
        <th>User</th>
        <th class="num">Pages</th>
        <th class="num">Size</th>
        <th>PDF / Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${docs.length === 0 ? '<p class="muted" style="margin-top:16px">No documents yet.</p>' : ''}
  ${docs.length === 100 ? '<p class="muted" style="margin-top:16px">Showing 100 most recent. Use /admin/documents?offset=… for older.</p>' : ''}
</main>
</body>
</html>`;

    return reply.type('text/html; charset=utf-8').send(html);
  });
}
