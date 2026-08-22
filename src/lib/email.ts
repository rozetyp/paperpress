import { env } from '../env.js';

type SendArgs = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail({ to, subject, text }: SendArgs): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Dev fallback: print so you can grab the key from terminal output.
    console.log('[email:console]', { to, subject, text });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`resend_failed: ${res.status} ${body}`);
  }
}

export function keyEmailBody(key: string, isNew: boolean): string {
  const lines = [
    isNew ? 'Welcome to paperpress.' : 'You requested a new paperpress API key.',
    '',
    'Your API key:',
    '',
    `  ${key}`,
    '',
    isNew
      ? `You start with ${env.FREE_TIER_CREDITS} free credits. Each rendered page uses 1 credit.`
      : `Your previous key will keep working for ${env.KEY_GRACE_PERIOD_HOURS} hours, then stop. Update your MCP config or environment before then.`,
    '',
    'Quickstart:',
    '  curl -X POST https://api.paperpress.dev/v1/documents \\',
    `    -H "Authorization: Bearer ${key}" \\`,
    '    -H "Content-Type: application/json" \\',
    `    -d '{"markdown":"# Hello"}'`,
    '',
    'If you did not request this, ignore the email — no action is needed.',
  ];
  return lines.join('\n');
}
