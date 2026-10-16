'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icons';

/** The figure at the top of the phone's Home: a money figure can be hidden with one tap (the choice stays on this phone). */
export function Headline({ label, value, unit, sub, money, hide, show }: { label: string; value: string; unit?: string; sub?: string; money: boolean; hide: string; show: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem('rs_hide_balance') === '1'); } catch { /* private window */ } }, []);
  const toggle = () => setHidden(h => { try { localStorage.setItem('rs_hide_balance', h ? '0' : '1'); } catch { /* private window */ } return !h; });
  return (
    <div className="fig">
      <div className="l">{label}</div>
      <div className={'v' + (money ? ' mono' : '')}>{money && hidden ? '••••••' : value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="s" dir="auto">{sub}</div>}
      {money && <button type="button" className="h" onClick={toggle}><Icon name={hidden ? 'eye' : 'eye-off'} />{hidden ? show : hide}</button>}
    </div>);
}
