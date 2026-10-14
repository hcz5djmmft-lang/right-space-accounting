'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clockAction } from '@/app/(app)/clock/actions';
import { CategoryPicker, type Office, type PickerCategory, type PickerProject } from './CategoryPicker';
import { shrink } from './shrink';

type Pos = { lat: number; lng: number; acc: number | null } | null;
/** Where the phone is, or null when the person refuses, the phone cannot tell within ten seconds, or a permission prompt is left unanswered for fifteen. */
function locate(): Promise<Pos> {
  return new Promise(res => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res(null);
    const cap = setTimeout(() => res(null), 15000);   // the browser's own timeout only starts once the permission prompt is answered
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(cap); res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null }); },
      () => { clearTimeout(cap); res(null); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}

export type OpenRec = { in_time: string; what: string; where: string };
/** The clock-in / clock-out card: what the day is for, then the button that opens the front camera; the selfie, the position and the pick go up together. */
export function ClockCard({ open, categories, projects, pick, office }: { open: OpenRec | null; categories: PickerCategory[]; projects: PickerProject[]; pick: { category: string; project: string | null }; office: Office }) {
  const cam = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tap = () => {
    if (!open && form.current) {
      const fd = new FormData(form.current);
      const c = categories.find(x => x.key === fd.get('category'));
      if (c?.project && !fd.get('project')) return setMsg({ text: 'Choose the project.', bad: true });
    }
    setMsg(null);
    cam.current?.click();
  };
  const send = (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (input) input.value = '';
    if (!f) return;
    start(async () => {
      const fd = form.current ? new FormData(form.current) : new FormData();
      setMsg({ text: 'Finding your location…', bad: false });
      const [pos, photo] = await Promise.all([locate(), shrink(f)]);
      fd.append('photo', photo, 'selfie.jpg');
      if (pos) { fd.append('lat', String(pos.lat)); fd.append('lng', String(pos.lng)); if (pos.acc) fd.append('acc', String(pos.acc)); }
      setMsg({ text: 'Sending…', bad: false });
      try {
        const r = await clockAction(open ? 'out' : 'in', fd);
        if (r.error) setMsg({ text: r.error, bad: true });
        else { setMsg({ text: r.ok ?? 'Done.', bad: false }); router.refresh(); }
      } catch { setMsg({ text: 'The photo could not be sent. Check the connection and try again.', bad: true }); }
    });
  };
  return (
    <form ref={form} className="card" style={{ textAlign: 'center' }} onSubmit={e => e.preventDefault()}>
      <div className="muted" style={{ fontSize: 13 }}>{open ? <>Clocked in at <b className="mono">{open.in_time}</b> · <b>{open.what}</b> · {open.where}</> : 'Not clocked in'}</div>
      {!open && <div style={{ textAlign: 'left', marginTop: 10 }}><CategoryPicker title="Clock in for" categories={categories} projects={projects} category={pick.category} project={pick.project} office={office} /></div>}
      <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={e => send(e.currentTarget)} />
      <button type="button" className={'btn ' + (open ? '' : 'pri')} disabled={pending} onClick={tap}
        style={{ margin: '14px auto', fontSize: 18, padding: '16px 28px', minWidth: 220, justifyContent: 'center' }}>
        {pending ? 'Working…' : open ? '📷 Clock out' : '📷 Clock in'}
      </button>
      <div className="muted" style={{ fontSize: 12 }}>The camera opens for a selfie; your location is sent with it and the system tells you where it saw you.</div>
      {msg && <div className={'msg ' + (msg.bad ? 'bad' : 'good')} style={{ marginTop: 10, textAlign: 'left' }}>{msg.text}</div>}
    </form>
  );
}
