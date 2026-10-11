-- BOQ per project (Adel, 2026-10-11): an Excel BOQ is uploaded for a project and compared with what is actually spent
-- on each of the project's GL codes. One BOQ per project; uploading again replaces it. Each line is matched to one of
-- the project's GL codes (suggested on upload, changed by hand on the BOQ page).
create table boqs (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null unique references projects(id) on delete cascade,
  file_name   text not null default '',
  uploaded_by text references users(id),
  uploaded_at timestamptz not null default now()
);

create table boq_lines (
  id          bigserial primary key,
  boq_id      text not null references boqs(id) on delete cascade,
  line_no     int not null,
  item_no     text not null default '',
  description text not null,
  unit        text not null default '',
  qty         numeric(18,3) not null default 0,
  rate        numeric(18,2) not null default 0,
  amount      numeric(18,2) not null,
  account     text references accounts(code)
);
create index on boq_lines (boq_id);
