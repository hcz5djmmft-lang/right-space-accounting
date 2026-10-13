import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { listRecords, listSessions } from '@/lib/attendance';
import { fmtMin } from '@/lib/attendance-calc';
import { fmt } from '@/lib/money';
import { checkAction, closeAction } from '../actions';

const maps = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? `https://maps.google.com/?q=${lat},${lng}` : null);

export default async function EmployeeAttendance({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string; error?: string }> }) {
  const user = await requireUser('hr', 'finance');
  const { id } = await params;
  const { month = today().slice(0, 7), error } = await searchParams;
  const [e] = await sql<{ name: string; code: string | null; work_location: string }[]>`select name, code, work_location from employees where id = ${id}`;
  if (!e) notFound();
  const [records, photos, sessions] = await Promise.all([
    listRecords({ employee: id, period: month }),
    sql<{ id: string; entity_id: string; tag: string | null }[]>`select a.id, a.entity_id, a.tag from attachments a where a.entity = 'attendance' and a.entity_id in (select id from attendance where employee_id = ${id} and to_char(day,'YYYY-MM') = ${month})`,
    listSessions({ employee: id, period: month }),
  ]);
  const canCheck = hasRole(user, 'hr');
  const photo = (rec: string, tag: string) => photos.find(p => p.entity_id === rec && p.tag === tag);
  const tot = records.reduce((a, r) => ({ worked: a.worked + r.worked_min, late: a.late + r.late_min, ot: a.ot + r.overtime_min }), { worked: 0, late: 0, ot: 0 });
  return (
    <>
      <div className="head"><div><h1 dir="auto">{e.name}</h1><p>{e.code} · {e.work_location === 'site' ? 'Site staff' : 'Office staff'} · {month}: {records.length} days, worked {fmtMin(tot.worked)}, late {fmtMin(tot.late)}, overtime {fmtMin(tot.ot)}</p></div>
        <div className="row"><Link className="btn" href={`/attendance?month=${month}`}>Back to the month</Link><Link className="btn" href={`/hr/employees/${id}`}>Employee file</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      {records.length === 0 && <div className="empty card">No clock-ins in {month}.</div>}
      {records.map(r => (
        <div key={r.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><b className="mono">{r.day}</b> · in <b className="mono">{r.in_time}</b> · out <b className="mono">{r.out_time ?? '— still open'}</b>
              {r.late_min ? <span className="pill rejected" style={{ marginLeft: 6 }}>late {fmtMin(r.late_min)}</span> : null}
              {r.overtime_min ? <span className="pill posted" style={{ marginLeft: 6 }}>overtime {fmtMin(r.overtime_min)}</span> : null}
              {r.worked_min ? <span className="muted" style={{ marginLeft: 6 }}>worked {fmtMin(r.worked_min)}</span> : null}</div>
            <div>{r.checked_by ? <span className="pill posted">checked by {r.checker} · {r.checked_at}</span> : <span className="pill pending">not checked</span>}</div>
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start', gap: 16 }}>
            {(['in', 'out'] as const).map(tag => {
              const p = photo(r.id, tag), lat = tag === 'in' ? r.in_lat : r.out_lat, lng = tag === 'in' ? r.in_lng : r.out_lng, place = tag === 'in' ? r.in_place : r.out_place;
              if (tag === 'out' && !r.out_at) return null;
              return (
                <figure key={tag} className="thumb" style={{ width: 150 }}>
                  {p ? <a href={`/files/${p.id}`} target="_blank" rel="noopener"><img src={`/files/${p.id}`} alt={`${tag} selfie`} loading="lazy" /></a> : <div className="thumb-doc">no selfie</div>}
                  <figcaption><span>{tag === 'in' ? 'Clock in' : 'Clock out'} · <span className={place === 'away' ? 'pill rejected' : 'pill'}>{place ?? '—'}</span></span>
                    <small>{maps(lat, lng) ? <a href={maps(lat, lng)!} target="_blank" rel="noopener">Open in Maps</a> : <span className="muted">no location</span>}</small></figcaption>
                </figure>);
            })}
            {canCheck && (
              <div style={{ flex: 1, minWidth: 220 }}>
                {!r.checked_by && <form action={checkAction.bind(null, id, month, r.id)} className="row"><input className="inp" name="note" dir="auto" placeholder="Note (optional)" style={{ flex: 1 }} /><button className="btn">Mark checked</button></form>}
                {r.hr_note && <p className="muted" style={{ fontSize: 13 }}>HR note: {r.hr_note}</p>}
                {!r.out_at && <form action={closeAction.bind(null, id, month, r.id)} className="row" style={{ marginTop: 8 }}><input className="inp" type="datetime-local" name="out_at" defaultValue={`${r.day}T17:00`} required style={{ maxWidth: 220 }} /><input className="inp" name="note" placeholder="Why (forgot to clock out…)" dir="auto" style={{ flex: 1, minWidth: 140 }} /><button className="btn">Close the day</button></form>}
              </div>)}
          </div>
        </div>))}
      {sessions.length > 0 && (
        <div className="card"><h2 style={{ marginTop: 0 }}>Design work in {month}</h2>
          <div className="tw"><table><thead><tr><th>Day</th><th>Project</th><th>From</th><th>To</th><th className="num">Hours</th><th className="num">Cost</th><th className="hide-sm">Note</th></tr></thead>
            <tbody>{sessions.map(x => <tr key={x.id}><td className="mono">{x.day}</td><td className="mono"><Link href={`/cost-centers/${x.project_id}`}>{x.project_code}</Link></td><td className="mono">{x.start_time}</td><td className="mono">{x.end_time ?? '…'}</td><td className="num mono">{fmtMin(x.minutes)}</td><td className="num mono">{fmt(x.cost)}</td><td className="hide-sm" dir="auto">{x.note}</td></tr>)}</tbody></table></div>
        </div>)}
    </>
  );
}
