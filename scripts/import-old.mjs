// Imports the old Right Space Accounting artifact database into the new system.
// Input: an export in the shape { "<collection>": { "<doc id>": {...} } }, either as JSON
// or as the preview's sample-data.js (window.__SEED = {...}).
// Usage: DATABASE_URL=... node scripts/import-old.mjs <file> [--replace]
// Runs in one transaction: either everything is imported or nothing is.
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { dbOptions } from './db-options.mjs';
import { resolveDatabaseUrl } from './db-url.mjs';


export function readExport(f) {
  const text = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.json')) return JSON.parse(text);
  const ctx = { window: {} };
  vm.runInNewContext(text, ctx);
  return ctx.window.__SEED;
}

const blank = v => (v === '' || v === undefined ? null : v);
const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const vals = o => Object.entries(o || {}).map(([id, v]) => ({ id, ...v }));

/** Imports the old tenders/{id} documents plus their trades subcollection ("tenders/<id>/trades"). */
export async function importTenders(tx, d) {
  const partyIds = new Set(vals(d.parties).map(p => p.id));
  const party = id => (id && partyIds.has(id) ? id : null);
  for (const t of vals(d.tenders)) {
    await tx`insert into tenders (id, no, name, client_id, client_name, location, due_date, status, type, service, unit, rates, markup, vat, notes, project_id, created_at)
      values (${t.id}, ${t.no}, ${t.name}, ${party(t.client)}, ${t.clientName || ''}, ${t.location || ''}, ${blank(t.dueDate)}, ${t.status || 'Draft'},
        ${blank(t.type)}, ${blank(t.service)}, ${blank(t.unit)}, ${tx.json(Object.fromEntries(Object.entries(t.rates || {}).map(([k, v]) => [k, num(v)])))},
        ${num(t.markup)}, ${num(t.vat) ?? 14}, ${t.notes || ''}, ${blank(t.project)}, ${t.createdAt || new Date().toISOString()})`;
    const trades = vals(d[`tenders/${t.id}/trades`]).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    for (const [k, tr] of trades.entries()) {
      const tid = `${t.id}:${tr.id}`;
      const bidders = tr.bidders || [], items = tr.items || [];
      const selected = bidders.some(b => b.id === tr.selected) ? `${tid}:${tr.selected}` : null;
      await tx`insert into tender_trades (id, tender_id, position, trade_no, name, division, markup, selected_bidder)
        values (${tid}, ${t.id}, ${tr.order ?? k + 1}, ${tr.tradeNo == null || tr.tradeNo === '' ? null : String(tr.tradeNo)}, ${tr.name}, ${tr.division || ''}, ${num(tr.markup)}, ${selected})`;
      for (const [i, it] of items.entries())
        await tx`insert into tender_items (id, trade_id, position, no, code, description, unit, qty, act_qty)
          values (${`${tid}:${it.id}`}, ${tid}, ${i + 1}, ${it.no == null ? '' : String(it.no)}, ${it.code == null || it.code === '' ? null : String(it.code)}, ${it.desc || ''}, ${it.unit || ''}, ${num(it.qty)}, ${num(it.actQty)})`;
      for (const [i, b] of bidders.entries()) {
        const bid = `${tid}:${b.id}`;
        await tx`insert into tender_bidders (id, trade_id, position, name, party_id, currency, wastage, discount, tax)
          values (${bid}, ${tid}, ${i + 1}, ${b.name || ''}, ${party(b.party)}, ${b.cur || 'EGP'}, ${num(b.wastage)}, ${num(b.disc)}, ${num(b.tax)})`;
        for (const [iid, p] of Object.entries(tr.prices?.[b.id] || {})) {
          if (num(p.offer) === null || !items.some(it => it.id === iid)) continue;
          await tx`insert into tender_prices (bidder_id, item_id, offer, logistics, misc) values (${bid}, ${`${tid}:${iid}`}, ${num(p.offer)}, ${num(p.logi)}, ${num(p.misc)})`;
        }
      }
    }
  }
}

export async function importOld(sql, d, { replace = false } = {}) {
  const counts = {};
  await sql.begin(async tx => {
    const existing = await tx`select count(*)::int n from accounts`;
    if (existing[0].n && !replace) throw new Error('The database already has accounts. Pass --replace to wipe and re-import.');
    if (replace) {
      await tx.unsafe(`alter table journal_entries disable trigger journal_entries_guard;
        alter table journal_lines disable trigger journal_lines_guard;
        alter table accounts disable trigger accounts_guard;
        truncate payment_allocations, payments, invoice_approvals, invoice_lines, invoices,
          journal_lines, journal_entries, audit_log, accounts, employees, projects, parties, departments, counters, tenders,
          payroll_lines, payroll_runs, bank_cleared, bank_statements, attachments, task_comments, tasks cascade;
        alter table journal_entries enable trigger journal_entries_guard;
        alter table journal_lines enable trigger journal_lines_guard;
        alter table accounts enable trigger accounts_guard;`);
    }

    const c = d.settings?.company || {};
    await tx`update settings set
      company_name = ${c.company || 'Right Space Development'}, vat_rate = ${num(c.vat) ?? 14},
      require_approval = ${c.requireApproval !== false}, require_cc = ${c.requireCC !== false},
      lock_date = null, pr_prefix = ${c.prPrefix || 'C-'}, fy_start_month = ${Number(c.fyStart || 1)},
      cats = ${tx.json(c.cats || {})}, account_map = ${tx.json(c.map || {})}, payroll = ${tx.json(c.pay || {})}
      where id = 1`;
    // the step names come from the old app; the approvers ticked in the new Settings page stay as they are
    if (Array.isArray(c.chain) && c.chain.length) {
      for (const [i, s] of c.chain.entries())
        await tx`insert into approval_steps (position, name) values (${i + 1}, ${s.name}) on conflict (position) do update set name = excluded.name`;
      await tx`delete from approval_steps where position > ${c.chain.length}`;
    }

    for (const x of vals(d.departments))
      await tx`insert into departments (id, code, name, active) values (${x.id}, ${x.code || x.id.toUpperCase()}, ${x.name}, ${x.active !== false})`;
    counts.departments = vals(d.departments).length;

    for (const x of vals(d.parties))
      await tx`insert into parties (id, code, type, name, full_name, email, phone, bank_name, account_no, iban, swift, tax_id, wht_rate, notes)
        values (${x.id}, ${blank(x.code)}, ${x.type}, ${x.name}, ${blank(x.fullName)}, ${blank(x.email)}, ${blank(x.phone)},
          ${blank(x.bankName)}, ${blank(x.accountNo)}, ${blank(x.iban)}, ${blank(x.swift)}, ${blank(x.taxId)}, ${num(x.whtRate) ?? 0}, ${blank(x.notes)})`;
    counts.parties = vals(d.parties).length;

    for (const x of vals(d.projects)) {
      const client = x.client ? (await tx`select id from parties where id = ${x.client} or name = ${x.client} limit 1`)[0]?.id : null;
      await tx`insert into projects (id, code, name, client_id, type, service, unit, location, area, contract, budget, status,
          start_date, end_date, gl_suffix, description, is_office)
        values (${x.id}, ${x.code || x.name}, ${x.name}, ${client ?? null}, ${blank(x.type)}, ${blank(x.service)}, ${blank(x.unit)},
          ${blank(x.location)}, ${num(x.area)}, ${num(x.contract)}, ${num(x.budget)}, ${x.status || 'Active'},
          ${blank(x.start)}, ${blank(x.end)}, ${num(x.glSuffix)}, ${blank(x.desc)}, ${x.id === 'office'})`;
    }
    counts.projects = vals(d.projects).length;

    // parents before children
    const accs = vals(d.accounts);
    const byCode = new Map(accs.map(a => [a.id, a]));
    const done = new Set();
    const insertAcc = async a => {
      if (done.has(a.id)) return;
      if (a.parent && byCode.has(a.parent)) await insertAcc(byCode.get(a.parent));
      await tx`insert into accounts (code, name, type, parent, postable, is_bank, is_system, budget, cost_type, project_id)
        values (${a.id}, ${a.name}, ${a.type}, ${a.parent && byCode.has(a.parent) ? a.parent : null}, ${a.postable !== false},
          ${!!a.bank}, ${!!a.sys}, ${num(a.budget)}, ${blank(a.costType)}, ${blank(a.project)})`;
      done.add(a.id);
    };
    for (const a of accs) await insertAcc(a);
    counts.accounts = accs.length;

    const kindOf = j => j.source?.col === 'invoices' ? 'payment_request'
      : j.source?.col === 'payments' ? 'payment'
      : j.reverses ? 'reversal'
      : ['expense', 'collection', 'transfer'].includes(j.type) ? j.type : 'adjustment';
    const journal = vals(d.journal).sort((a, b) => String(a.no).localeCompare(String(b.no)));
    for (const j of journal) {
      await tx`insert into journal_entries (id, no, date, memo, ref, kind, status, form, source_type, source_id, created_at)
        values (${j.id}, ${j.no}, ${j.date}, ${j.memo || ''}, ${j.ref || ''}, ${kindOf(j)}, 'draft',
          ${tx.json({ items: j.items || [], bank: j.bank || '', toBank: j.toBank || '', party: j.party || '', vatRate: j.vatRate || 0, amount: j.amount || 0 })},
          ${j.source?.col === 'invoices' ? 'invoice' : j.source?.col === 'payments' ? 'payment' : null}, ${j.source?.id ?? null},
          ${j.createdAt || new Date().toISOString()})`;
      for (const [i, l] of (j.lines || []).entries())
        await tx`insert into journal_lines (entry_id, line_no, account, dr, cr, project_id, dept_id, party_id, description)
          values (${j.id}, ${i + 1}, ${l.acc}, ${Number(l.dr) || 0}, ${Number(l.cr) || 0}, ${blank(l.project)}, ${blank(l.dept)}, ${blank(l.party)}, ${l.desc || ''})`;
      for (const g of j.log || [])
        await tx`insert into audit_log (at, entity, entity_id, action, note) values (${g.at}, 'journal', ${j.id}, ${g.act}, ${g.note || ''})`;
    }
    for (const j of journal) {
      if (j.status === 'draft') continue;
      await tx`update journal_entries set status = ${j.status}, posted_at = ${j.postedAt ?? null} where id = ${j.id}`;
    }
    for (const j of journal) {
      if (j.reverses) await tx`update journal_entries set reverses_id = ${j.reverses} where id = ${j.id} and status <> 'posted'`;
      if (j.reversedBy) await tx`update journal_entries set reversed_by = ${j.reversedBy} where id = ${j.id}`;
    }
    counts.journal = journal.length;

    for (const v of vals(d.invoices)) {
      await tx`insert into invoices (id, kind, no, date, due_date, party_id, project_id, dept_id, cost_type, ref, requester,
          vat_rate, wht_rate, si_rate, ret_rate, dp_amount, subtotal, vat, wht, si, retention, total, net, status, entry_id)
        values (${v.id}, ${v.kind}, ${v.no}, ${v.date}, ${blank(v.due)}, ${v.party}, ${v.project === 'office' || v.project ? blank(v.project) : null},
          ${blank(v.dept)}, ${blank(v.btype)}, ${v.ref || ''}, ${blank(v.requester)},
          ${num(v.vatRate) ?? 0}, ${num(v.whtRate) ?? 0}, ${num(v.siRate) ?? 0}, ${num(v.retRate) ?? 0}, ${num(v.dpAmt) ?? 0},
          ${num(v.sub) ?? 0}, ${num(v.vat) ?? 0}, ${num(v.wht) ?? 0}, ${num(v.si) ?? 0}, ${num(v.ret) ?? 0}, ${num(v.total) ?? 0},
          ${num(v.net) ?? num(v.total) ?? 0}, ${v.status}, ${blank(v.jeId)})`;
      for (const [i, l] of (v.lines || []).entries())
        await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id, dept_id)
          values (${v.id}, ${i + 1}, ${l.acc}, ${l.desc || ''}, ${Number(l.qty) || 0}, ${Number(l.price) || 0}, ${blank(l.project)}, ${blank(l.dept)})`;
      for (const [i, a] of (v.approvals || []).entries())
        await tx`insert into invoice_approvals (invoice_id, step, step_name, at) values (${v.id}, ${i + 1}, ${a.step}, ${a.at})`;
      for (const g of v.log || [])
        await tx`insert into audit_log (at, entity, entity_id, action, note) values (${g.at}, 'invoice', ${v.id}, ${g.act}, ${g.note || ''})`;
    }
    counts.invoices = vals(d.invoices).length;

    for (const p of vals(d.payments)) {
      await tx`insert into payments (id, kind, no, date, party_id, bank, amount, wht, memo, ref, status, entry_id)
        values (${p.id}, ${p.kind}, ${p.no}, ${p.date}, ${p.party}, ${p.bank}, ${Number(p.amount)}, ${Number(p.wht) || 0},
          ${p.memo || ''}, ${p.ref || ''}, ${p.status}, ${blank(p.jeId)})`;
      for (const a of p.alloc || [])
        await tx`insert into payment_allocations (payment_id, invoice_id, amount) values (${p.id}, ${a.inv}, ${Number(a.amt)})`;
      for (const g of p.log || [])
        await tx`insert into audit_log (at, entity, entity_id, action, note) values (${g.at}, 'payment', ${p.id}, ${g.act}, ${g.note || ''})`;
    }
    counts.payments = vals(d.payments).length;

    await importTenders(tx, d);
    counts.tenders = vals(d.tenders).length;

    // numbering continues after the highest imported number
    const maxNo = (rows, re) => rows.reduce((m, r) => { const x = re.exec(r.no || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
    const counters = {
      'JE-': maxNo(journal, /^JE-(\d+)$/),
      [c.prPrefix || 'C-']: maxNo(vals(d.invoices).filter(v => v.kind === 'purchase'), /^\D+-(\d+)$/),
      'INV-': maxNo(vals(d.invoices).filter(v => v.kind === 'sales'), /^INV-(\d+)$/),
      'PAY-': maxNo(vals(d.payments).filter(p => p.kind === 'payment'), /^PAY-(\d+)$/),
      'RCT-': maxNo(vals(d.payments).filter(p => p.kind === 'receipt'), /^RCT-(\d+)$/),
      'TND-': maxNo(vals(d.tenders), /^TND-(\d+)$/),
    };
    for (const [name, value] of Object.entries(counters))
      await tx`insert into counters (name, value) values (${name}, ${value}) on conflict (name) do update set value = excluded.value`;

    // the lock date goes on last: with it set earlier, the ledger guard would refuse the old entries dated before it
    await tx`update settings set lock_date = ${blank(c.lockDate)} where id = 1`;
  });
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...flags] = process.argv.slice(2);
  const url = resolveDatabaseUrl();
  if (!file || !url) {
    console.error('Usage: DATABASE_URL=... node scripts/import-old.mjs <export file> [--replace --yes]');
    process.exit(1);
  }
  const replace = flags.includes('--replace');
  const sql = postgres(url, dbOptions(url));
  try {
    if (replace) {
      // wiping posted books cannot be undone: say which database and how much it holds, and ask for --yes
      const [n] = await sql`select (select count(*) from journal_entries)::int entries, (select count(*) from payroll_runs)::int payroll_runs,
        (select count(*) from attachments)::int attachments, (select count(*) from tasks)::int tasks`;
      console.log(`--replace wipes the books on ${new URL(url).host}: ${n.entries} entries, ${n.payroll_runs} payroll runs, ${n.attachments} attachments, ${n.tasks} tasks. Logins and settings stay.`);
      if (!flags.includes('--yes')) throw new Error('Add --yes to go ahead.');
    }
    const counts = await importOld(sql, readExport(file), { replace });
    console.log('Imported', counts);
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  } finally { await sql.end(); }
}
