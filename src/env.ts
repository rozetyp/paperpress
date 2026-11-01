import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STORAGE_DIR: z.string().default('./storage'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  SIGNING_SECRET: z.string().min(16),
  PLAYWRIGHT_MAX_CONTEXTS: z.coerce.number().default(2),
  RENDER_TIMEOUT_MS: z.coerce.number().default(30_000),
  // No accounts, so this per-IP budget is the only thing standing between the
  // public internet and the Chromium pool. Shared by /v1/documents and the MCP
  // generate_pdf tool.
  RENDERS_PER_HOUR: z.coerce.number().default(30),
  // Hard cap so a single request can't render a 10,000-page PDF and burn the
  // Chromium pool. Renders that exceed this are rejected (413) and the PDF
  // isn't persisted.
  MAX_PAGES_PER_RENDER: z.coerce.number().default(200),
});

export const env = Env.parse(process.env);
