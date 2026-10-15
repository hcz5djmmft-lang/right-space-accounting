'use client';

/** A form button that asks first (update 20: Delete on Settings > People). */
export function ConfirmButton({ action, question, label, className = 'btn sm bad' }: { action: () => Promise<void>; question: string; label: string; className?: string }) {
  return <button className={className} formAction={action} formNoValidate onClick={e => { if (!confirm(question)) e.preventDefault(); }}>{label}</button>;
}
