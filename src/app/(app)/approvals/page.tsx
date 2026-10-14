import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { waitingForUser } from '@/lib/documents';
import { tr, trParts } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

export default async function Approvals() {
  const user = await requireUser();
  const rows = await waitingForUser(user);
  const lang = await getLang(), t = (x: string) => tr(lang, x);
  return (
    <>
      <div className="head"><div><h1>{t('Approvals')}</h1><p>{t('Everything waiting for your signature.')}</p></div></div>
      {rows.length === 0 ? <div className="empty card">{t('Nothing is waiting for you.')}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('No.')}</th><th>{t('Type')}</th><th>{t('Date')}</th><th>{t('Vendor / description')}</th><th className="hide-sm">{t('Raised by')}</th><th className="num">{t('Amount')}</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.href}><td className="mono"><Link href={r.href}>{r.no}</Link></td><td>{trParts(lang, r.type)}</td><td className="mono">{r.date}</td>
            <td dir="auto">{r.memo}</td><td className="hide-sm">{r.who}</td><td className="num">{fmt(r.amount)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
