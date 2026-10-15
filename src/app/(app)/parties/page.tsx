import { redirect } from 'next/navigation';

/** The old Customers & vendors address, split in update 19: send old links and bookmarks to the right half. */
export default async function Parties({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const q = await searchParams;
  const qs = new URLSearchParams();
  if (q.tab === 'sub') qs.set('tab', 'sub');
  if (q.error) qs.set('error', q.error);
  const rest = qs.toString();
  redirect(`${q.tab === 'customer' ? '/customers' : '/vendors'}${rest ? '?' + rest : ''}`);
}
