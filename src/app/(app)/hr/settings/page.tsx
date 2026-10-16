import { requireUser } from '@/lib/auth';
import { getHr } from '@/lib/attendance';
import { UseMyLocation } from '@/components/UseMyLocation';
import { saveHrAction, testHrEmailAction } from '../../attendance/actions';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function HrSettings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireUser('hr');
  const { saved, error } = await searchParams;
  const s = await getHr();
  return (
    <>
      <div className="head"><div><h1>Attendance settings</h1><p>Where the office is, when the day starts and ends, and how overtime and lateness reach payroll.</p></div></div>
      {saved && <div className="msg good">{saved === '1' ? 'Saved.' : saved}</div>}
      {error && <div className="msg bad">{error}</div>}
      <form action={saveHrAction}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Office location</h2>
          <p className="muted" style={{ marginTop: 0 }}>Office, Design and Finance clock-ins must be within this distance of the office (a Site clock-in is checked against the project's own pin). Until it is set, they are recorded wherever the person is.</p>
          <div className="grid g3">
            <label className="f"><span>Latitude</span><input className="inp mono" name="office_lat" defaultValue={s.office_lat ?? ''} inputMode="decimal" placeholder="e.g. 31.2001" /></label>
            <label className="f"><span>Longitude</span><input className="inp mono" name="office_lng" defaultValue={s.office_lng ?? ''} inputMode="decimal" placeholder="e.g. 29.9187" /></label>
            <label className="f"><span>Allowed distance (metres)</span><input className="inp mono" name="office_radius_m" defaultValue={s.office_radius_m} inputMode="numeric" /></label>
          </div>
          <div style={{ marginTop: 10 }}><UseMyLocation /></div>
          <label className="f" style={{ marginTop: 12 }}><span>Email each site clock-in to (empty: everyone given HR under Settings &gt; People)</span>
            <input className="inp" type="email" name="hr_email" defaultValue={s.hr_email} placeholder="hr@…" /></label>
          <div style={{ marginTop: 10 }}><button className="btn" formAction={testHrEmailAction} formNoValidate>Send test email</button> <span className="muted">to the address above (or everyone given HR) and shows what happened</span></div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Working day</h2>
          <div className="grid g4">
            <label className="f"><span>Day starts</span><input className="inp mono" type="time" name="work_start" defaultValue={s.work_start} /></label>
            <label className="f"><span>Day ends</span><input className="inp mono" type="time" name="work_end" defaultValue={s.work_end} /></label>
            <label className="f"><span>Grace before late (minutes)</span><input className="inp mono" name="grace_min" defaultValue={s.grace_min} inputMode="numeric" /></label>
            <label className="f"><span>Overtime counts from (minutes)</span><input className="inp mono" name="min_overtime_min" defaultValue={s.min_overtime_min} inputMode="numeric" /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><span className="muted">Weekend:</span>{DAYS.map((d, i) => <label key={d} className="row" style={{ fontSize: 14, gap: 4 }}><input type="checkbox" name="weekend" value={i} defaultChecked={s.weekend.includes(i)} />{d}</label>)}</div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pay</h2>
          <p className="muted" style={{ marginTop: 0 }}>Hourly cost = (basic + allowances) ÷ (hours a day × days a month). It prices design hours on projects, overtime and lateness.</p>
          <div className="grid g4">
            <label className="f"><span>Hours a day</span><input className="inp mono" name="hours_per_day" defaultValue={s.hours_per_day} inputMode="decimal" /></label>
            <label className="f"><span>Working days a month</span><input className="inp mono" name="days_per_month" defaultValue={s.days_per_month} inputMode="decimal" /></label>
            <label className="f"><span>Overtime rate (× hourly cost)</span><input className="inp mono" name="overtime_rate" defaultValue={s.overtime_rate} inputMode="decimal" /></label>
            <label className="row" style={{ alignSelf: 'end', fontSize: 14 }}><input type="checkbox" name="late_deduction" defaultChecked={s.late_deduction} /> Deduct lateness from pay</label>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Save settings</button></div>
      </form>
    </>
  );
}
