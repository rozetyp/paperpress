import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STORAGE_DIR: z.string().default('./storage'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  SIGNING_SECRET: z.string().min(16),
  PLAYWRIGHT_MAX_CONTEXTS: z.coerce.number().default(2),
  RENDER_TIMEOUT_MS: z.coerce.number().default(30_000),
  FREE_TIER_CREDITS: z.coerce.number().default(100),
  // Email (Resend). When RESEND_API_KEY is unset, sendEmail logs to stdout
  // instead — handy in dev so you don't need a Resend account to test flows.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('paperpress <onboarding@paperpress.dev>'),
  // Old keys stay valid this long after a rotation so MCP configs / cron jobs
  // don't break instantly. Set to 0 to revoke immediately.
  KEY_GRACE_PERIOD_HOURS: z.coerce.number().default(24),
  // Hard cap so a single request can't render a 10,000-page PDF and burn the
  // Chromium pool. Renders that exceed this are rejected (413), not billed,
  // and the PDF isn't persisted.
  MAX_PAGES_PER_RENDER: z.coerce.number().default(200),
  // Admin surface (read-only). When unset, /admin/* routes return 404 — so a
  // dev env without the token has zero attack surface there. Set it on the
  // server to enable.
  ADMIN_TOKEN: z.string().min(32).optional(),
});

export const env = Env.parse(process.env);
