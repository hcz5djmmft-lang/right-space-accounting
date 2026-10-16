import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole, type User } from '@/lib/roles';
import { pushKeys } from '@/lib/push';
import { PushButton } from '@/components/PushButton';
import { Headline } from '@/components/Headline';
import { Icon } from '@/components/Icons';
import { pendingSteps } from '@/lib/pending';
import { waitingForUser } from '@/lib/documents';
import { bankAccounts } from '@/lib/banks';
import { employeeOf, openRecord, openSession } from '@/lib/attendance';
import { categoryOf, whatLabel } from '@/lib/clock-categories';
import { fmt } from '@/lib/money';
import { DASHBOARDS, dashboard, dashboardsFor, type DashKey } from '@/lib/home';
import { type Lang, tr } from '@/lib/i18n';
import { getLang } from '@/lib/lang';
import { signOutAction } from '@/app/sign-out-action';

/** The phone's headline figure: cash and bank (the bank accounts and petty cash, not the credit card) for Management and Finance
 *  with AP; for everyone else, today's clock-in. */
async function headline(user: User, lang: Lang) {
  const t = (x: string) => tr(lang, x);
  if (hasRole(user, 'management') || (user.access ?? []).includes('ap')) {
    const total = (await bankAccounts()).filter(a => !a.hidden && a.kind !== 'card').reduce((s, a) => s + a.balance, 0);
    return { label: t('Cash and bank'), value: fmt(total), unit: 'EGP', money: true };
  }
  const me = await employeeOf(user.id);
  const open = me ? await openRecord(me.id) : null;
  const now = me && open ? (await openSession(me.id)) ?? open : null;
  const c = now ? categoryOf(now.category) : null;
  const what = !c || !now ? '' : lang === 'ar' ? (c.project && now.project_code ? `${t(c.short)} ${t('on')} ${now.project_code}` : t(c.project ? c.short : c.label)) : whatLabel(c, now.project_code);
  return { label: t('Today'), value: open ? `${t('Clocked in at')} ${open.in_time}` : t('Not clocked in'), sub: what, money: false };
}

/**
 * Overview (update 20, item 1): the pending steps for me at the top, then the dashboard of my department. Someone in two
 * departments switches at the top; Management sees all seven, starting with its own. On a phone the page opens like the bank
 * app Adel sent: a cocoa header with the headline figure, a floating card of quick actions, a round + button.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string; d?: string }> }) {
  const user = await requireUser();
  const { denied, d } = await searchParams;
  const mine = await dashboardsFor(user);
  const key = (mine.includes(d as DashKey) ? d : mine[0]) as DashKey | undefined;
  const lang = await getLang();
  const [steps, dash, { publicKey }, waiting, hl] = await Promise.all([pendingSteps(user), key ? dashboard(key, user) : null, pushKeys(), waitingForUser(user), headline(user, lang)]);
  const t = (x: string) => tr(lang, x);
  const n = waiting.length;
  return (
    <>
      <header className="hero">
        <div className="top">
          <div><img src="/logo.svg" alt="Right Space" /><div className="co" dir="auto">Right Space Development · {user.name}</div></div>
          <form action={signOutAction}><button className="rbtn" aria-label={t('Sign out')} title={t('Sign out')}><Icon name="out" /></button></form>
        </div>
        <Headline label={hl.label} value={hl.value} unit={hl.unit} sub={hl.sub} money={hl.money} hide={t('Hide balances')} show={t('Show balances')} />
      </header>
      <nav className="quick" aria-label={t('Quick actions')}>
        <Link href="/clock"><Icon name="clock" />{t('Clock in')}</Link>
        <Link href="/approvals"><Icon name="stamp" />{t('Approvals')}{n > 0 && <span className="badge">{n}</span>}</Link>
        <Link href="/purchasing/new"><Icon name="cart" />{t('New request')}</Link>
      </nav>
      <Link className="fab" href="/purchasing/new" aria-label={t('New purchase request')} title={t('New purchase request')}><Icon name="plus" /></Link>

      {denied && <div className="msg bad">{t('Your access does not include that page.')}</div>}
      <div className="head hide-sm">
        <div><h1>{t('Good day')}, {user.name.split(' ')[0]}</h1><p>Right Space Development{dash ? ` · ${t(dash.title)}` : ''}</p></div>
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
