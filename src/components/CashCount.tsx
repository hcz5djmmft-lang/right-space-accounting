'use client';
import { useState } from 'react';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The count sheet: how many of each note and coin, with the running total and the difference against the books. */
export function CashCount({ denominations, book }: { denominations: readonly number[]; book: number }) {
  const [n, setN] = useState<Record<string, string>>({});
  const total = denominations.reduce((t, d) => t + d * (Number(n[d]) || 0), 0);
  const diff = Math.round((total - book) * 100) / 100;
  return (
    <>
      <div className="tw"><table>
        <thead><tr><th>Note or coin</th><th className="num">How many</th><th className="num">Amount</th></tr></thead>
        <tbody>{denominations.map(d => (
          <tr key={d}><td>{d >= 1 ? `${d} pounds` : `${d * 100} piastres`}</td>
            <td className="num"><input className="inp mono" name={`n_${d}`} inputMode="numeric" value={n[d] ?? ''} onChange={e => setN({ ...n, [d]: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 90, textAlign: 'right' }} aria-label={`${d} count`} /></td>
            <td className="num">{fmt(d * (Number(n[d]) || 0))}</td></tr>))}</tbody>
        <tfoot>
          <tr><td>Counted</td><td></td><td className="num">{fmt(total)}</td></tr>
          <tr><td>In the books today</td><td></td><td className="num">{fmt(book)}</td></tr>
          <tr><td>Difference</td><td></td><td className="num" style={{ color: diff ? 'var(--bad)' : undefined }}>{diff > 0 ? '+' : ''}{fmt(diff)}</td></tr>
        </tfoot>
      </table></div>
    </>
  );
}
