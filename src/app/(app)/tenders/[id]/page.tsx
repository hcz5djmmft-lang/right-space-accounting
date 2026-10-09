import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { loadTender } from '@/lib/tenders';
import { tenderInputs, tenderTotals, type Step } from '@/lib/tender-calc';
import { BidsStep, BoqStep, ClientStep, CompareStep, DetailsStep } from '@/components/tender-steps';

const STEPS: [Step, string][] = [['details', '1 · Details'], ['boq', '2 · BOQ'], ['bids', '3 · Bidders & prices'], ['compare', '4 · Comparison & award'], ['client', '5 · Client price']];

export default async function TenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; trade?: string; misc?: string; error?: string; ok?: string }> }) {
  await requireUser('tenders');
  const { id } = await params;
  const { step = 'details', trade, misc, error, ok } = await searchParams;
  const t = await loadTender(id);
  if (!t) notFound();
  const [settings, customers, vendors] = await Promise.all([
    getSettings(),
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`,
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'vendor' order by name`,
  ]);
  const T = tenderTotals(t);
  const need = tenderInputs(t);
  const cur = t.trades.find(x => x.id === trade) ?? t.trades[0];
  const margin = T.client ? Math.round((T.client - T.cost) / T.client * 100) : null;
  const common = { t, cur, showMisc: misc === '1' };
  return (
    <>
      <div className="head">
        <div><h1><span className="mono muted" style={{ fontWeight: 500 }}>{t.no}</span> <span dir="auto">{t.name}</span></h1>
          <p dir="auto">{t.client ?? 'No client yet'} · {t.status}{t.due_date ? ` · submission ${t.due_date}` : ''}{t.project_code ? ` · cost center ${t.project_code}` : ''}</p></div>
        <div className="row"><Link className="btn" href="/tenders">All tenders</Link><a className="btn" href={`/print/tender/${id}`} target="_blank">Printable tender</a></div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">BOQ</div><div className="v">{T.items}</div><div className="muted" style={{ fontSize: 12 }}>{T.trades} trades · {T.priced} priced</div></div>
        <div className="tile"><div className="k">Cost (selected offers)</div><div className="v mono">{fmt(T.cost)}</div></div>
        <div className="tile"><div className="k">Client price before VAT</div><div className="v mono">{fmt(T.client)}</div><div className="muted" style={{ fontSize: 12 }}>{margin !== null ? `Margin ${margin}%` : 'Set markup in step 5'}</div></div>
        <div className="tile"><div className="k">Client price incl. VAT {t.vat}%</div><div className="v mono">{fmt(T.client + T.vat)}</div></div>
      </div>
      <div className="tabs">{STEPS.map(([k, l]) => <Link key={k} href={`/tenders/${id}?step=${k}${cur ? `&trade=${cur.id}` : ''}`} className={step === k ? 'on' : ''}>{l}</Link>)}</div>
      <div className={'tgrid' + (step === 'bids' || step === 'compare' ? ' wide' : '')}>
        <div style={{ minWidth: 0 }}>
          {step === 'details' && <DetailsStep t={t} cats={settings.cats} customers={customers} />}
          {step === 'boq' && <BoqStep {...common} />}
          {step === 'bids' && <BidsStep {...common} vendors={vendors} />}
          {step === 'compare' && <CompareStep {...common} />}
          {step === 'client' && <ClientStep {...common} T={T} />}
        </div>
        <aside className="card" style={{ position: 'sticky', top: 12 }}>
          <h2>Inputs needed <small className="muted">{need.length}</small></h2>
          {need.length === 0 ? <p className="muted" style={{ margin: 0 }}>Everything is filled in.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '60vh', overflow: 'auto' }}>
              {need.slice(0, 60).map(([st, tr, m], i) => <Link key={i} href={`/tenders/${id}?step=${st}${tr ? `&trade=${tr}` : ''}`} dir="auto" style={{ color: 'var(--text)', fontSize: 13, textDecoration: 'none', borderLeft: '3px solid var(--gold, #e5b35a)', paddingLeft: 8 }}>{m}</Link>)}
              {need.length > 60 && <span className="muted">+{need.length - 60} more</span>}
            </div>)}
        </aside>
      </div>
    </>
  );
}
