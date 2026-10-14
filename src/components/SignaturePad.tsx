'use client';
import { useEffect, useRef, useState } from 'react';

/** Signing with a finger (or the mouse): the drawing goes into the form as a PNG in `name`. */
export function SignaturePad({ name = 'signature' }: { name?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState('');
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const g = c.getContext('2d')!;
    g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    const at = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e: PointerEvent) => { drawing.current = true; c.setPointerCapture(e.pointerId); const [x, y] = at(e); g.beginPath(); g.moveTo(x, y); e.preventDefault(); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const [x, y] = at(e); g.lineTo(x, y); g.stroke(); e.preventDefault(); };
    const up = () => { if (!drawing.current) return; drawing.current = false; setData(c.toDataURL('image/png')); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); };
  }, []);

  function clear() {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setData('');
  }
  return (
    <div>
      <canvas ref={canvas} style={{ width: '100%', height: 160, border: '1px dashed var(--line)', borderRadius: 8, background: '#fff', touchAction: 'none', display: 'block' }} />
      <input type="hidden" name={name} value={data} />
      <button type="button" className="btn sm" onClick={clear} style={{ marginTop: 6 }}>Clear</button>
    </div>
  );
}
