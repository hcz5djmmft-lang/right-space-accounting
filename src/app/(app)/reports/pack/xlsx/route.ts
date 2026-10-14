import { currentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { today } from '@/lib/dates';
import { packSheets, statementsPack } from '@/lib/pack';
import { writeXlsx } from '@/lib/xlsx-write';

/** The statements pack of a month as an Excel workbook: /reports/pack/xlsx?m=2026-10 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  if (!hasRole(user, 'finance')) return new Response('Finance only', { status: 403 });
  const m = new URL(req.url).searchParams.get('m') ?? '';
  const p = await statementsPack(/^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today().slice(0, 7));
  const name = `RS Statements ${p.period}.xlsx`;
  return new Response(new Uint8Array(writeXlsx(packSheets(p))), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  } });
}
