import 'server-only';
import { morningSummary, notifyPending } from './push';

// The daily run, called by the Vercel scheduler (vercel.json) at 05:00 and 06:00 UTC: 08:00 Cairo in summer and in
// winter. The morning summary goes once a day, from 08:00 Cairo, so the other call (or a stray one) does nothing.
// With CRON_SECRET set in the hosting settings only the scheduler may call it; without it a call can at most send the
// day's summary that would have gone anyway.
export async function dailyRun(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'not allowed' }, { status: 401 });
  const morning = await morningSummary();
  const pending = await notifyPending({ force: true });
  return Response.json({ morning, pending });
}
