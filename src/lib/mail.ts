import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

// The sender is configuration, not code. Either of two Vercel variables turns email on:
//   RESEND_API_KEY   a key from resend.com (API Keys > Create API key); free up to 3,000 emails a month
//   SMTP_URL         smtps://rightspace.accounts%40gmail.com:<app password>@smtp.gmail.com:465 (a Gmail account)
//   EMAIL_FROM       optional, "Right Space <rightspace.accounts@gmail.com>"; Resend's own test sender otherwise
// With neither (local and test), nothing is sent: the log notes the recipient and subject, never the body,
// because a temporary password travels in the body. A failed email never undoes what the person did.

export type Mail = { to: string[]; subject: string; text: string };
export const sentInTest: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(m: Mail) {
  const to = [...new Set(m.to.filter(Boolean))];
  if (!to.length) return;
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Right Space <onboarding@resend.dev>', to, subject: m.subject, text: m.text }),
      });
      if (!r.ok) console.error('Email failed', r.status, (await r.text()).slice(0, 300));
    } catch (e) { console.error('Email failed', e); }
    return;
  }
  if (!process.env.SMTP_URL) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) sentInTest.push({ ...m, to });
    else console.log(`[email not configured, not sent] to ${to.join(', ')}: ${m.subject}`);
    return;
  }
  try {
    // short timeouts: the approver's phone is waiting on this; a slow mail server must not hold the approval
    transport ??= nodemailer.createTransport({ url: process.env.SMTP_URL, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject: m.subject, text: m.text });
  } catch (e) {
    // an email failure (or a mistyped SMTP_URL) must never undo an approval; it is logged and the request still shows in Approvals
    console.error('Email failed', e);
  }
}

// the Vercel address is used until APP_URL names a domain
export const appUrl = (path: string) =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')) + path;
