// Company-local dates. The server may run in UTC (Vercel), but "today" for the books is Egypt's day.
export const TZ = process.env.APP_TZ || 'Africa/Cairo';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date as YYYY-MM-DD in the company's time zone (APP_TZ, default Africa/Cairo). */
export const today = (now = new Date()) => fmt.format(now);
