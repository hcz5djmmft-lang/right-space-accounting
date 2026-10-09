import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

// The sender is configuration, not code: today a Gmail account (SMTP), later a company domain.
//   SMTP_URL=smtps://rightspace.accounts%40gmail.com:<app password>@smtp.gmail.com:465
//   EMAIL_FROM="Right Space Accounting <rightspace.accounts@gmail.com>"
// With no SMTP_URL (local and test), nothing is sent: the log notes the recipient and subject, never the body,
// because a temporary password travels in the body.

export type Mail = { to: string[]; subject: string; text: string };
export const sentInTest: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(m: Mail) {
  const to = [...new Set(m.to.filter(Boolean))];
  if (!to.length) return;
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
