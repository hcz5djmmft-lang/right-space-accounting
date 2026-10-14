import Link from 'next/link';
import { requireUser } from '@/lib/auth';

/** Manual entries are gone (update 18): every entry comes from a document. This page only says where each one is made. */
export default async function NewEntry() {
  await requireUser();
  return (
    <>
      <div className="head"><div><h1>No manual entries</h1><p>Every entry comes from the system.</p></div></div>
      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <div>An expense: from a vendor&apos;s or subcontractor&apos;s invoice, through <Link href="/payment-requests">Payment requests</Link>.</div>
        <div>A collection: <Link href="/collections">Collections</Link> &gt; Money received.</div>
        <div>A transfer: from an approved payment request (Pay).</div>
        <div>Cash out of the office: <Link href="/petty-cash">Petty cash</Link>.</div>
      </div>
    </>
  );
}
