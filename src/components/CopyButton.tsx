'use client';
import { useState } from 'react';

/** Copies a text (a link, a message) to the clipboard. */
export function CopyButton({ text, label = 'Copy link', className = 'btn sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 2000);
  }
  return <button type="button" className={className} onClick={copy}>{done ? 'Copied' : label}</button>;
}
