import { BanksView, type BanksParams } from './BanksView';

export default function Banks({ searchParams }: { searchParams: BanksParams }) {
  return <BanksView searchParams={searchParams} mode="cash" />;
}
