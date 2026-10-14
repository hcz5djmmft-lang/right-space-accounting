'use client';
import { useState } from 'react';

/** Fills a latitude and a longitude box from the phone's position: HR stands at the office, or an engineer on the site, and taps it. */
export function UseMyLocation({ lat = 'office_lat', lng = 'office_lng' }: { lat?: string; lng?: string }) {
  const [msg, setMsg] = useState('');
  const fill = () => {
    if (!navigator.geolocation) return setMsg('This browser cannot give a location.');
    setMsg('Finding your position…');
    navigator.geolocation.getCurrentPosition(p => {
      (document.querySelector(`input[name=${lat}]`) as HTMLInputElement).value = p.coords.latitude.toFixed(6);
      (document.querySelector(`input[name=${lng}]`) as HTMLInputElement).value = p.coords.longitude.toFixed(6);
      setMsg(`Filled from your phone (accurate to about ${Math.round(p.coords.accuracy)} m). Save below.`);
    }, () => setMsg('Location refused or not available. Allow it for this site and try again.'), { enableHighAccuracy: true, timeout: 15000 });
  };
  return <div className="row"><button type="button" className="btn" onClick={fill}>📍 Use my current location</button>{msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}</div>;
}
