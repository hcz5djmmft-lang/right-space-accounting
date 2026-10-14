// Petty cash (improvement 15) against the test database: the count sheet against the books, the top-up request and its
// approval from the bank, the month-end close item, and a card statement with purchases as plain amounts.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), sendNotification: async () => ({}) } }));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const petty = await import('@/lib/petty');
const close = await import('@/lib/close');
const st = await import('@/lib/statements');
const { waitingForUser } = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const ziad = { id: '', email: 'ziad@x.test', name: 'Ziad', roles: ['finance'] };
const adel = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };
const BOX = 'A110';
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, cash_counts, petty_topups, statement_lines cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [ziad, adel]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null where id = 1`;
  await sql`insert into accounts (code, name, type, parent, postable, is_bank) values ('L115', 'CIB credit card', 'liability', 'L100', true, true) on conflict (code) do nothing`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, holder) values ('A110', 'cash', 'PT-', 'Office'), ('L115', 'card', 'CC-12-', null), ('A120', 'bank', 'CIB-34-', null) on conflict (account) do nothing`;
  await books.saveEntry(ziad as never, { date: '2026-10-01', ref: '', form: { type: 'transfer', memo: 'Float', bank: 'A120', toBank: BOX, amount: 2000, items: [] } }, 'post');
  await books.saveEntry(ziad as never, { date: '2026-10-05', ref: '', form: { type: 'expense', memo: 'Taxi', bank: BOX, vatRate: 0, items: [{ project: 'ph-b1302', acc: '25001-1', amount: 350 }] } }, 'post');
});
afterAll(async () => { await sql.end(); });

describe('petty cash', () => {
  it('counts the box by denomination against the books, a difference needing a note', async () => {
    const [b] = await petty.pettyBoxes();
    expect(b).toMatchObject({ code: BOX, balance: 1650, last_count: null });
    await expect(petty.countCash(ziad as never, BOX, '2026-10-06', { 200: 8 })).rejects.toThrow('The count is 1,600.00 and the books say 1,650.00. Write a note on the difference of -50.00.');
    const r = await petty.countCash(ziad as never, BOX, '2026-10-06', { 200: 8, 20: 2, 5: 2 });
    expect(r).toMatchObject({ counted: 1650, book: 1650, difference: 0 });
    const r2 = await petty.countCash(ziad as never, BOX, '2026-10-06', { 200: 8, 20: 2, 0.5: 2 }, 'Missing receipt');
    expect(r2).toMatchObject({ counted: 1641, difference: -9 });
    expect((await petty.cashCounts(BOX))[0]).toMatchObject({ notes: { '200': 8, '20': 2, '0.5': 2 }, remark: 'Missing receipt', who: 'Ziad' });
    await expect(petty.countCash(ziad as never, BOX, '2026-10-06', { 200: 1.5 })).rejects.toThrow(/whole number/);
  });
  it('the month-end close ticks petty cash from the count', async () => {
    const item = async (p: string) => (await close.closeChecklist(p)).items.find(i => i.key === 'petty')!;
    expect(await item('2026-10')).toMatchObject({ done: true, detail: 'Counted on the Petty cash page' });
    expect(await item('2026-11')).toMatchObject({ done: false });
  });
  it('asks for a top-up up to the float; someone else approves it from the bank', async () => {
    await petty.setFloat(ziad as never, BOX, 3000);
    const id = await petty.requestTopup(ziad as never, BOX, 1350, 'Site week');
    await expect(petty.requestTopup(ziad as never, BOX, 100, '')).rejects.toThrow(/already waiting/);
    await expect(petty.approveTopup(ziad as never, id, 'A120')).rejects.toThrow(/someone else in Finance/);
    expect((await waitingForUser(adel as never)).some(w => w.type === 'Petty cash top-up')).toBe(true);
    expect((await waitingForUser(ziad as never)).some(w => w.type === 'Petty cash top-up')).toBe(false);
    await expect(petty.approveTopup(adel as never, id, BOX)).rejects.toThrow(/bank account/);
    await petty.approveTopup(adel as never, id, 'A120', '2026-10-07');
    expect((await petty.pettyBoxes())[0].balance).toBe(3000);
    expect((await petty.topups())[0]).toMatchObject({ status: 'paid', decided: 'Adel', entry_no: expect.stringMatching(/^JE-/) });
    await expect(petty.approveTopup(adel as never, id, 'A120')).rejects.toThrow(/not waiting/);
  });
  it('turning down needs a reason; the one who asked can cancel', async () => {
    const id = await petty.requestTopup(ziad as never, BOX, 500, '');
    await expect(petty.rejectTopup(adel as never, id, '')).rejects.toThrow(/Say why/);
    await petty.rejectTopup(ziad as never, id, '');
    expect((await petty.topups())[0]).toMatchObject({ status: 'cancelled' });
  });
});

describe('credit card statement', () => {
  it('reads purchases printed as plain amounts and payments marked CR, and matches them', async () => {
    await books.saveEntry(ziad as never, { date: '2026-10-08', ref: '', form: { type: 'expense', memo: 'Paint', bank: 'L115', vatRate: 0, items: [{ project: 'ph-b1302', acc: '25001-1', amount: 1200 }] } }, 'post');
    await books.saveEntry(ziad as never, { date: '2026-10-09', ref: '', form: { type: 'transfer', memo: 'Card payment', bank: 'A120', toBank: 'L115', amount: 1000, items: [] } }, 'post');
    const csv = Buffer.from('Transaction Date,Description,Amount,Balance\n08/10/2026,PAINT SHOP,"1,200.00","1,200.00"\n09/10/2026,PAYMENT THANK YOU,1000.00 CR,200.00\n');
    const r = await st.importStatement(ziad as never, 'L115', 'card.csv', csv, { chargesPositive: true });
    expect(r).toMatchObject({ read: 2, added: 2, matched: 2 });
    expect((await sql`select stmt_balance::float b from bank_statements where account = 'L115'`)[0].b).toBe(-200);
  });
});
