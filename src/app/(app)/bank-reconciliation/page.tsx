import { BanksView, type BanksParams } from '../banks/BanksView';

/** Closing > Bank reconciliation (update 20): the reconciliation that was on Banks & cash, on its own page. */
export default function BankReconciliation({ searchParams }: { searchParams: BanksParams }) {
  return <BanksView searchParams={searchParams} mode="rec" />;
}
