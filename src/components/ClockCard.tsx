'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clockAction } from '@/app/(app)/clock/actions';
import { CategoryPicker, type Office, type PickerCategory, type PickerProject } from './CategoryPicker';
import { shrink } from './shrink';
import { tr, type Lang } from '@/lib/i18n';

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
export function ClockCard({ open, categories, projects, pick, office, lang = 'en' }: { open: OpenRec | null; categories: PickerCategory[]; projects: PickerProject[]; pick: { category: string; project: string | null }; office: Office; lang?: Lang }) {
  const t = (x: string) => tr(lang, x);
  const cam = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tap = () => {
    if (!open && form.current) {
      const fd = new FormData(form.current);
      const c = categories.find(x => x.key === fd.get('category'));
      if (c?.project && !fd.get('project')) return setMsg({ text: t('Choose the project.'), bad: true });
    }
    setMsg(null);
    void openCamera();
  };
  // update 20: the button opens the camera to take the photo. Phones open their own camera from the file box; a computer
  // gets a live camera view here (its file box would open the photo library instead). Upload stays as a fallback.
  const [live, setLive] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const openCamera = async () => {
    const computer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
    if (!computer || !navigator.mediaDevices?.getUserMedia) return cam.current?.click();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setLive(stream);
      setTimeout(() => { if (video.current) { video.current.srcObject = stream; video.current.play().catch(() => {}); } }, 0);
    } catch { cam.current?.click(); }
  };
  const closeCamera = () => { live?.getTracks().forEach(tr => tr.stop()); setLive(null); };
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob(b => { closeCamera(); if (b) sendFile(new File([b], 'selfie.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
  };
  const send = (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (input) input.value = '';
    if (f) sendFile(f);
  };
  const sendFile = (f: File) => {
    start(async () => {
      const fd = form.current ? new FormData(form.current) : new FormData();
      setMsg({ text: t('Finding your location…'), bad: false });
      const [pos, photo] = await Promise.all([locate(), shrink(f)]);
      fd.append('photo', photo, 'selfie.jpg');
      if (pos) { fd.append('lat', String(pos.lat)); fd.append('lng', String(pos.lng)); if (pos.acc) fd.append('acc', String(pos.acc)); }
      setMsg({ text: t('Sending…'), bad: false });
      try {
        const r = await clockAction(open ? 'out' : 'in', fd);
        if (r.error) setMsg({ text: r.error, bad: true });
        else { setMsg({ text: r.ok ?? t('Done.'), bad: false }); router.refresh(); }
      } catch { setMsg({ text: t('The photo could not be sent. Check the connection and try again.'), bad: true }); }
    });
  };
  return (
    <form ref={form} className="card" style={{ textAlign: 'center' }} onSubmit={e => e.preventDefault()}>
      <div className="muted" style={{ fontSize: 13 }}>{open ? <>{t('Clocked in at')} <b className="mono">{open.in_time}</b> · <b>{open.what}</b> · {open.where}</> : t('Not clocked in')}</div>
      {!open && <div style={{ textAlign: 'start', marginTop: 10 }}><CategoryPicker title={t('Clock in for')} categories={categories} projects={projects} category={pick.category} project={pick.project} office={office} lang={lang} /></div>}
      <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={e => send(e.currentTarget)} />
      <input ref={upload} type="file" accept="image/*" hidden onChange={e => send(e.currentTarget)} />
      {live && (
        <div className="camera">
          <video ref={video} playsInline muted autoPlay />
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button type="button" className="btn pri" onClick={snap}>{t('📷 Take photo')}</button>
            <button type="button" className="btn" onClick={closeCamera}>{t('Cancel')}</button>
          </div>
          <button type="button" className="linkbtn" onClick={() => { closeCamera(); upload.current?.click(); }}>{t('Upload a photo instead')}</button>
        </div>)}
      <button type="button" className={'btn ' + (open ? '' : 'pri')} disabled={pending} onClick={tap}
        style={{ margin: '14px auto', fontSize: 18, padding: '16px 28px', minWidth: 220, justifyContent: 'center' }}>
        {pending ? t('Working…') : open ? t('📷 Clock out') : t('📷 Clock in')}
      </button>
      <div className="muted" style={{ fontSize: 12 }}>{t('The camera opens for a selfie; your location is sent with it and the system tells you where it saw you.')}</div>
      {msg && <div className={'msg ' + (msg.bad ? 'bad' : 'good')} style={{ marginTop: 10, textAlign: 'start' }}>{msg.text}</div>}
    </form>
  );
}
