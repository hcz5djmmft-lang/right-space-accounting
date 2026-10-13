'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clockAction } from '@/app/(app)/clock/actions';
import { shrink } from './shrink';

type Pos = { lat: number; lng: number; acc: number | null } | null;
/** Where the phone is, or null when the person refuses or the phone cannot tell within ten seconds. */
function locate(): Promise<Pos> {
  return new Promise(res => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null }),
      () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}

/** The clock-in / clock-out button: tapping opens the front camera; the selfie and the position go up together. */
export function ClockCard({ open, inTime, place, needOffice }: { open: boolean; inTime: string | null; place: string | null; needOffice: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (input) input.value = '';
    if (!f) return;
    start(async () => {
      setMsg({ text: 'Finding your location…', bad: false });
      const [pos, photo] = await Promise.all([locate(), shrink(f)]);
      const fd = new FormData();
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
    <div className="card" style={{ textAlign: 'center' }}>
      <div className="muted" style={{ fontSize: 13 }}>{open ? <>Clocked in at <b className="mono">{inTime}</b>{place && place !== 'unknown' ? ` · ${place}` : ''}</> : 'Not clocked in'}</div>
      <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={e => send(e.currentTarget)} />
      <button type="button" className={'btn ' + (open ? '' : 'pri')} disabled={pending} onClick={() => cam.current?.click()}
        style={{ margin: '14px auto', fontSize: 18, padding: '16px 28px', minWidth: 220, justifyContent: 'center' }}>
        {pending ? 'Working…' : open ? '📷 Clock out' : '📷 Clock in'}
      </button>
      <div className="muted" style={{ fontSize: 12 }}>The camera opens for a selfie; your location is sent with it.{needOffice ? ' Office staff can clock in only at the office.' : ''}</div>
      {msg && <div className={'msg ' + (msg.bad ? 'bad' : 'good')} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}
