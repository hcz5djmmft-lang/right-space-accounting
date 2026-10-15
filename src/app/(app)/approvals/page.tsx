import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { waitingForUser } from '@/lib/documents';
import { tr, trParts } from '@/lib/i18n';
import { getLang } from '@/lib/lang';
import { approveRow } from './actions';

/** Everything waiting for my signature; each row has its Approve button (update 20). Returning or rejecting stays on the
 *  document's own page, where the reason is written. */
export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { ok, error } = await searchParams;
  const rows = await waitingForUser(user);
  const lang = await getLang(), t = (x: string) => tr(lang, x);
  return (
    <>
      <div className="head"><div><h1>{t('Approvals')}</h1><p>{t('Everything waiting for your signature.')} {t('Approve signs it here; open the number to read it or to return it.')}</p></div></div>
      {ok && <div className="msg good">{t('Approved.')}</div>}
      {error && <div className="msg bad">{error}</div>}
      {rows.length === 0 ? <div className="empty card">{t('Nothing is waiting for you.')}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('No.')}</th><th>{t('Type')}</th><th>{t('Date')}</th><th>{t('Vendor / description')}</th><th className="hide-sm">{t('Raised by')}</th><th className="num">{t('Amount')}</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.href + r.type}><td className="mono"><Link href={r.href}>{r.no}</Link></td><td>{trParts(lang, r.type)}</td><td className="mono">{r.date}</td>
            <td dir="auto">{r.memo}</td><td className="hide-sm">{r.who}</td><td className="num">{fmt(r.amount)}</td>
            <td>{r.act ? <form action={approveRow.bind(null, r.act)}><button className="btn sm pri">{t('Approve')}</button></form>
              : <Link className="btn sm" href={r.href}>{t('View')}</Link>}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
