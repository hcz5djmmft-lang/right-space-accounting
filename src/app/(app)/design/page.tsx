import { DesignBoard } from './DesignBoard';

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; error?: string; saved?: string }> }) {
  return <DesignBoard searchParams={searchParams} />;
}
