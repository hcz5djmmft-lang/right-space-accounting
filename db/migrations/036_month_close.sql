-- Month-end close (improvement 9): a checklist per month. The system ticks what it can tell from the books (bank and
-- card reconciled to month end, payroll posted, nothing left waiting); Finance ticks the rest. Management then locks
-- the books to the month end (settings.lock_date), which the ledger guard already enforces on every posting.
create table month_closes (
  period     text primary key check (period ~ '^\d{4}-\d{2}$'),
  ticks      jsonb not null default '{}',   -- manual items: { key: { by, at } }
  closed_by  text references users(id),
  closed_at  timestamptz
);
