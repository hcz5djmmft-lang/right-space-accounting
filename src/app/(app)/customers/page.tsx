import { PartyList } from '../parties/list';

/** AR > Customers: the customer half of the old Customers & vendors page. */
export default async function Customers({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <PartyList side="ar" q={await searchParams} />;
}
