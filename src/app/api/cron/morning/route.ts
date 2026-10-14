import { dailyRun } from '@/lib/cron';

// the morning summary and reminders (src/lib/cron.ts)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = (req: Request) => dailyRun(req);
