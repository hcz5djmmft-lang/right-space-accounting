'use client';
import { useEffect, useState } from 'react';
import { removePushAction, savePushAction, testPushAction } from '@/app/push-actions';

type State = 'checking' | 'off' | 'on' | 'blocked' | 'home-screen' | 'unsupported' | 'working';

const toKey = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** "Turn on notifications" for this phone. `compact` (Overview) shows nothing once they are on. */
export function PushButton({ publicKey, compact = false }: { publicKey: string; compact?: boolean }) {
  const [state, setState] = useState<State>('checking');
  const [note, setNote] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(isIos() && !standalone() ? 'home-screen' : 'unsupported'); return;
      }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      try { if (compact && localStorage.getItem('push-not-now')) setHidden(true); } catch {}
      const sub = await currentSub().catch(() => null);
      if (sub) { await savePushAction(sub.toJSON() as never, navigator.userAgent); setState('on'); } // keeps the server's copy fresh
      else setState('off');
    })();
  }, [compact]);

  async function turnOn() {
    setState('working'); setNote('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      const err = await savePushAction(sub.toJSON() as never, navigator.userAgent);
      if (err) { setNote(err); setState('off'); return; }
      setState('on'); setNote('Notifications are on for this phone.');
    } catch (e) {
      console.error(e); setNote('This phone could not turn notifications on. Try again, or close the app and open it again.'); setState('off');
    }
  }
  async function turnOff() {
    setState('working');
    const sub = await currentSub().catch(() => null);
    if (sub) { await removePushAction(sub.endpoint); await sub.unsubscribe().catch(() => {}); }
    setState('off'); setNote('Notifications are off for this phone.');
  }
  async function test() {
    const n = await testPushAction();
    setNote(n ? 'Test sent. It shows in a few seconds.' : 'No phone of yours has notifications on.');
  }

  if (compact && hidden) return null;
  if (compact && (state === 'on' || state === 'checking' || state === 'unsupported')) return null;
  return (
    <div className={compact ? 'card' : undefined} style={compact ? { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } : undefined}>
      {state === 'checking' && <span className="muted">Checking this phone…</span>}
      {state === 'unsupported' && <span className="muted">This browser cannot show notifications. On a phone, open the system from its home-screen icon.</span>}
      {state === 'home-screen' && <span>On iPhone, notifications work from the home-screen app: in Safari tap Share, then <b>Add to Home Screen</b>, open Right Space from the new icon and come back here.</span>}
      {state === 'blocked' && <span>Notifications are blocked for this app. Allow them in the phone&apos;s Settings (Notifications, Right Space), then come back here.</span>}
      {(state === 'off' || state === 'working') && <>
        {compact && <span>Get a notification on this phone when an approval, a task or a claim waits for you.</span>}
        <button type="button" className="btn pri" disabled={state === 'working'} onClick={turnOn}>Turn on notifications</button>
        {compact && <button type="button" className="btn" onClick={() => { try { localStorage.setItem('push-not-now', '1'); } catch {} setHidden(true); }}>Not now</button>}
      </>}
      {state === 'on' && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="pill posted">On for this phone</span>
        <button type="button" className="btn" onClick={test}>Send a test</button>
        <button type="button" className="btn" onClick={turnOff}>Turn off</button>
      </div>}
      {note && <div className="muted" style={{ fontSize: 13, marginTop: 6, width: '100%' }}>{note}</div>}
    </div>
  );
}
