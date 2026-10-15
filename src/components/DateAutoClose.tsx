'use client';
import { useEffect } from 'react';

/**
 * Update 20 (item 32): a date box closes its calendar once a day is picked. Safari on a Mac keeps the calendar open after
 * a pick; leaving the box closes it. Typing a date with the keyboard is left alone.
 */
export function DateAutoClose() {
  useEffect(() => {
    let typed = 0;
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLInputElement)?.type === 'date') typed = Date.now(); };
    const change = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el?.type !== 'date' || !el.value || Date.now() - typed < 1000) return;
      setTimeout(() => el.blur(), 0);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('change', change, true);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('change', change, true); };
  }, []);
  return null;
}
