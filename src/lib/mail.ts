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
  const r = await deliver(m);
  if (r.sent) console.log(`Email sent to ${r.to.length} recipient(s): ${m.subject} (${r.detail})`);
}

/** Sends and says what happened in plain words, for HR's Send test email button and the logs. Never throws. */
export async function deliver(m: Mail): Promise<{ sent: boolean; to: string[]; detail: string }> {
  const to = [...new Set(m.to.filter(Boolean))];
  if (!to.length) { console.log(`[email not sent: nobody to send to] ${m.subject}`); return { sent: false, to, detail: 'There is nobody to send it to.' }; }
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Right Space <onboarding@resend.dev>', to, subject: m.subject, text: m.text }),
      });
      const body = (await r.text()).slice(0, 300);
      if (!r.ok) { console.error('Email failed', r.status, body); return { sent: false, to, detail: `Resend refused it (${r.status}): ${resendReason(body)}` }; }
      return { sent: true, to, detail: 'Resend accepted it.' };
    } catch (e) { console.error('Email failed', e); return { sent: false, to, detail: `Resend could not be reached: ${(e as Error).message}` }; }
  }
  if (!process.env.SMTP_URL) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) sentInTest.push({ ...m, to });
    else console.log(`[email not configured, not sent] to ${to.join(', ')}: ${m.subject}`);
    return { sent: false, to, detail: 'Email is not set up: the site does not see RESEND_API_KEY (check its name and that Production is ticked, then Redeploy).' };
  }
  try {
    // short timeouts: the approver's phone is waiting on this; a slow mail server must not hold the approval
    transport ??= nodemailer.createTransport({ url: process.env.SMTP_URL, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject: m.subject, text: m.text });
    return { sent: true, to, detail: 'The mail server accepted it.' };
  } catch (e) {
    // an email failure (or a mistyped SMTP_URL) must never undo an approval; it is logged and the request still shows in Approvals
    console.error('Email failed', e);
    return { sent: false, to, detail: `The mail server refused it: ${(e as Error).message}` };
  }
}

const resendReason = (body: string) => { try { return String(JSON.parse(body).message ?? body); } catch { return body; } };

// the Vercel address is used until APP_URL names a domain
export const appUrl = (path: string) =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')) + path;
