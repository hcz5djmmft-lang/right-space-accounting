import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

// The sender is configuration, not code: today a Gmail account (SMTP), later a company domain.
//   SMTP_URL=smtps://rightspace.accounts%40gmail.com:<app password>@smtp.gmail.com:465
//   EMAIL_FROM="Right Space Accounting <rightspace.accounts@gmail.com>"
// With no SMTP_URL (local and test), emails are written to the server log instead of sent.

export type Mail = { to: string[]; subject: string; text: string };
export const sentInTest: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(m: Mail) {
  const to = [...new Set(m.to.filter(Boolean))];
  if (!to.length) return;
  if (!process.env.SMTP_URL) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) sentInTest.push({ ...m, to });
    else console.log(`[email not configured] to ${to.join(', ')}: ${m.subject}\n${m.text}`);
    return;
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  try {
    await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject: m.subject, text: m.text });
  } catch (e) {
    // an email failure must never undo an approval; it is logged and the request still shows in Approvals
    console.error('Email failed', e);
  }
}

export const appUrl = (path: string) => (process.env.APP_URL ?? 'http://localhost:3000') + path;
