import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { pushKeys } from '@/lib/push';
import { PushButton } from '@/components/PushButton';
import { pendingSteps } from '@/lib/pending';
import { DASHBOARDS, dashboard, dashboardsFor, type DashKey } from '@/lib/home';
import { tr } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

/**
 * Overview (update 20, item 1): the pending steps for me at the top, the clock-in button on a phone, then the dashboard of my
 * department. Someone in two departments switches at the top; Management sees all seven, starting with its own.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string; d?: string }> }) {
  const user = await requireUser();
  const { denied, d } = await searchParams;
  const mine = await dashboardsFor(user);
  const key = (mine.includes(d as DashKey) ? d : mine[0]) as DashKey | undefined;
  const [steps, dash, { publicKey }, lang] = await Promise.all([pendingSteps(user), key ? dashboard(key, user) : null, pushKeys(), getLang()]);
  const t = (x: string) => tr(lang, x);
  return (
    <>
      {denied && <div className="msg bad">{t('Your access does not include that page.')}</div>}
      <div className="head">
        <div><h1>{t('Good day')}, {user.name.split(' ')[0]}</h1><p>Right Space Development{dash ? ` · ${t(dash.title)}` : ''}</p></div>
        <Link className="btn pri only-sm" href="/clock">{t('Clock in')}</Link>
      </div>
      <PushButton publicKey={publicKey} compact />

      {steps.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t('Pending steps for you')} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {steps.length}</span></h2>
          <div style={{ display: 'grid', gap: 6 }}>{steps.slice(0, 12).map((st, i) => <div key={i} className="row" style={{ gap: 8 }}><span className="pill pending" style={{ textTransform: 'capitalize' }}>{st.kind}</span><Link href={st.href} dir="auto">{st.title}</Link>{st.since && <span className="muted mono" style={{ fontSize: 12 }}>{st.since}</span>}</div>)}</div>
          {steps.length > 12 && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}><Link href="/tasks">{t('All pending steps')}</Link> · {steps.length}</p>}
        </div>)}

      {mine.length > 1 && <div className="tabs">{DASHBOARDS.filter(([k]) => mine.includes(k)).map(([k, l]) => <Link key={k} href={`/?d=${k}`} className={key === k ? 'on' : ''}>{t(l)}</Link>)}</div>}

      {dash && <>
        <div className="tiles">{dash.tiles.map((x, i) => {
          const body = <><div className="k">{t(x.label)}</div><div className="v mono">{x.value}</div>{x.sub && <div className="muted" style={{ fontSize: 12 }} dir="auto">{x.sub}</div>}</>;
          return x.href ? <Link key={i} href={x.href} className={'tile' + (x.warn ? ' warn' : '')} style={{ textDecoration: 'none' }}>{body}</Link> : <div key={i} className={'tile' + (x.warn ? ' warn' : '')}>{body}</div>;
        })}</div>
        <div className="grid g2">{dash.lists.map((l, i) => (
          <div key={i} className="card dash-list">
            <h2 style={{ marginTop: 0 }}>{l.href ? <Link href={l.href}>{t(l.title)}</Link> : t(l.title)}</h2>
            {l.rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t(l.empty)}</p>
              : l.rows.map((r, k) => (
                <div key={k} className="row-line">
                  <div dir="auto">{r.href ? <Link href={r.href} style={r.warn ? { color: 'var(--bad)' } : undefined}>{r.text}</Link> : <span style={r.warn ? { color: 'var(--bad)' } : undefined}>{r.text}</span>}{r.sub && <div className="sub">{r.sub}</div>}</div>
                  {r.value && <div className="mono" style={{ whiteSpace: 'nowrap' }}>{r.value}</div>}
                </div>))}
          </div>))}</div>
      </>}
    </>
  );
}
