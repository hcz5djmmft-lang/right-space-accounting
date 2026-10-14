-- Audit trail (improvement 16). Every create, edit, post, void and delete of a journal entry, an invoice (sales
-- invoices, payment requests and vendor invoices), a payment or receipt, and a payroll run is kept as a snapshot of the
-- whole record with its lines, taken when the change is committed. The snapshot before it is the "before"; who did it
-- comes from the app's own audit line written in the same transaction.
alter table audit_log add column txid bigint default txid_current();
create index on audit_log (txid);
create index on audit_log (at);

create table change_log (
  id      bigserial primary key,
  tbl     text not null,            -- journal | invoice | payment | payroll
  row_id  text not null,
  op      text not null check (op in ('create', 'change', 'delete')),
  data    jsonb not null,
  txid    bigint not null default txid_current(),
  at      timestamptz not null default now()
);
create index on change_log (tbl, row_id, id);
create index on change_log (txid);
create index on change_log (at);

create function audit_snapshot(t text, rid text) returns jsonb language plpgsql stable as $$
declare d jsonb;
begin
  if t = 'journal' then
    select to_jsonb(e) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l) - 'entry_id' - 'id' order by l.line_no) from journal_lines l where l.entry_id = rid), '[]'::jsonb))
      into d from journal_entries e where e.id = rid;
  elsif t = 'invoice' then
    select to_jsonb(i) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l) - 'invoice_id' - 'id' order by l.line_no) from invoice_lines l where l.invoice_id = rid), '[]'::jsonb))
      into d from invoices i where i.id = rid;
  elsif t = 'payment' then
    select to_jsonb(p) || jsonb_build_object('allocations', coalesce((select jsonb_agg(to_jsonb(a) - 'payment_id' order by a.invoice_id) from payment_allocations a where a.payment_id = rid), '[]'::jsonb))
      into d from payments p where p.id = rid;
  elsif t = 'payroll' then
    select to_jsonb(r) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l) - 'run_period' order by l.line_no) from payroll_lines l where l.run_period = rid), '[]'::jsonb))
      into d from payroll_runs r where r.period = rid;
  end if;
  return d;
end $$;

-- runs at commit (deferred), once per record and transaction, so the snapshot holds the record as it was left
create function audit_change() returns trigger language plpgsql as $$
declare t text := tg_argv[0]; col text := tg_argv[1]; rid text; d jsonb; last jsonb;
begin
  rid := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> col;
  if rid is null or exists (select 1 from change_log where tbl = t and row_id = rid and txid = txid_current()) then return null; end if;
  d := audit_snapshot(t, rid);
  if d is null then return null; end if;   -- deleted later in the same transaction: the delete was logged
  select c.data into last from change_log c where c.tbl = t and c.row_id = rid order by c.id desc limit 1;
  if last is not null and last = d then return null; end if;
  insert into change_log (tbl, row_id, op, data) values (t, rid, case when last is null and tg_op = 'INSERT' then 'create' else 'change' end, d);
  return null;
end $$;

-- a deleted record (a draft removed) keeps its last state
create function audit_delete() returns trigger language plpgsql as $$
declare t text := tg_argv[0]; col text := tg_argv[1]; rid text := to_jsonb(old) ->> col; d jsonb;
begin
  d := audit_snapshot(t, rid);
  if d is not null then insert into change_log (tbl, row_id, op, data) values (t, rid, 'delete', d); end if;
  return old;
end $$;

create constraint trigger audit_journal after insert or update on journal_entries deferrable initially deferred for each row execute function audit_change('journal', 'id');
create constraint trigger audit_journal_lines after insert or update or delete on journal_lines deferrable initially deferred for each row execute function audit_change('journal', 'entry_id');
create trigger audit_journal_delete before delete on journal_entries for each row execute function audit_delete('journal', 'id');

create constraint trigger audit_invoice after insert or update on invoices deferrable initially deferred for each row execute function audit_change('invoice', 'id');
create constraint trigger audit_invoice_lines after insert or update or delete on invoice_lines deferrable initially deferred for each row execute function audit_change('invoice', 'invoice_id');
create trigger audit_invoice_delete before delete on invoices for each row execute function audit_delete('invoice', 'id');

create constraint trigger audit_payment after insert or update on payments deferrable initially deferred for each row execute function audit_change('payment', 'id');
create constraint trigger audit_payment_alloc after insert or update or delete on payment_allocations deferrable initially deferred for each row execute function audit_change('payment', 'payment_id');
create trigger audit_payment_delete before delete on payments for each row execute function audit_delete('payment', 'id');

create constraint trigger audit_payroll after insert or update on payroll_runs deferrable initially deferred for each row execute function audit_change('payroll', 'period');
create constraint trigger audit_payroll_lines after insert or update or delete on payroll_lines deferrable initially deferred for each row execute function audit_change('payroll', 'run_period');
create trigger audit_payroll_delete before delete on payroll_runs for each row execute function audit_delete('payroll', 'period');
