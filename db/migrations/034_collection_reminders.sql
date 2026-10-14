-- Collections follow-up (improvement 7): one reminder task per open client invoice, raised on its due date and again
-- every seven days while money is still owed; closed by itself when the invoice is paid.
create table collection_reminders (
  invoice_id text primary key references invoices(id) on delete cascade,
  task_id    text references tasks(id) on delete set null,
  last_on    date not null,
  times      int not null default 1
);
