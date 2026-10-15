import { PartyList } from '../parties/list';

/** AP > Vendors & subcontractors: the vendor half of the old Customers & vendors page, with its two tabs. */
export default async function Vendors({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  return <PartyList side="ap" q={await searchParams} />;
}
