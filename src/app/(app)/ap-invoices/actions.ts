'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { recordServiceInvoice } from '@/lib/ap-invoices';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';

export async function serviceInvoiceAction(f: FormData) {
  const user = await requireUser('finance');
  const s = (k: string) => String(f.get(k) ?? '').trim();
  const all = (k: string) => f.getAll(k).map(v => String(v));
  const amounts = all('amount'), descs = all('desc');
  const assign = s('assign');
  let id = '', err = '';
  try {
    id = await recordServiceInvoice(user, {
      date: s('date'), due: s('due') || null, party: s('party'), ref: s('ref'),
      project: assign.startsWith('p:') ? assign.slice(2) : null, dept: assign.startsWith('d:') ? assign.slice(2) : null,
      vatRate: Number(s('vat')) || 0, whtRate: Number(s('wht')) || 0,
      lines: all('account').map((acc, k) => ({ acc, desc: descs[k] ?? '', amount: parseAmount(amounts[k] ?? '') })),
    });
  } catch (e) {
    err = e instanceof RuleError || (e instanceof Error && /locked|balanced|not one of|cannot/i.test(e.message)) ? (e as Error).message : (console.error(e), 'Something went wrong. Nothing was changed.');
  }
  revalidatePath('/', 'layout');
  redirect(err ? `/ap-invoices?new=1&error=${encodeURIComponent(err)}` : `/purchasing/invoices/${id}?ok=${encodeURIComponent('Invoice recorded. A payment request can now pay it.')}`);
}
