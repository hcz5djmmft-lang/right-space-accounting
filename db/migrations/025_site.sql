-- Site execution (Adel, 2026-10-13, update 16): daily site reports from the phone (work done, manpower, photos), inspection
-- requests with a task for the inspector, the snag list, and the handover certificate that moves the project to Handover.

create table site_reports (
  id            text primary key default gen_random_uuid()::text,
  no            text not null unique,                       -- SR-00001
  project_id    text not null references projects(id) on delete cascade,
  day           date not null,
  status        text not null default 'draft' check (status in ('draft','submitted','reviewed')),
  weather       text not null default '',
  work_done     text not null default '',
  materials     text not null default '',                   -- materials received on site
  issues        text not null default '',                   -- delays, problems, safety
  visitors      text not null default '',
  submitted_by  text references users(id),
  submitted_at  timestamptz,
  reviewed_by   text references users(id),
  reviewed_at   timestamptz,
  review_note   text not null default '',
  created_by    text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, day)
);

create table site_report_manpower (
  id          bigserial primary key,
  report_id   text not null references site_reports(id) on delete cascade,
  trade       text not null,
  headcount   int not null default 0,
  hours       numeric(5,1) not null default 8
);
create index on site_report_manpower (report_id);

-- the schedule activities worked on that day
create table site_report_work (
  report_id    text not null references site_reports(id) on delete cascade,
  activity_id  text not null references activities(id) on delete cascade,
  note         text not null default '',
  primary key (report_id, activity_id)
);

create table inspection_requests (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,                      -- IR-00001
  project_id     text not null references projects(id) on delete cascade,
  activity_id    text references activities(id) on delete set null,
  title          text not null,
  location       text not null default '',
  requested_for  date not null,
  status         text not null default 'open' check (status in ('open','passed','failed','cancelled')),
  inspector_id   text references users(id),
  task_id        text references tasks(id) on delete set null,
  result_note    text not null default '',
  inspected_by   text references users(id),
  inspected_at   timestamptz,
  requested_by   text references users(id),
  created_at     timestamptz not null default now()
);
create index on inspection_requests (project_id, status);

create table snags (
  id             text primary key default gen_random_uuid()::text,
  project_id     text not null references projects(id) on delete cascade,
  snag_no        int not null,                               -- S-1, S-2 … per project
  area           text not null default '',
  description    text not null,
  trade          text not null default '',
  priority       text not null default 'normal' check (priority in ('low','normal','high')),
  status         text not null default 'open' check (status in ('open','fixed','verified','cancelled')),
  vendor_id      text references parties(id),                -- the subcontractor who fixes it, when there is one
  assignee_id    text references users(id),
  due            date,
  inspection_id  text references inspection_requests(id) on delete set null,
  found_by       text references users(id),
  found_at       timestamptz not null default now(),
  fixed_by       text references users(id),
  fixed_at       timestamptz,
  fixed_note     text not null default '',
  verified_by    text references users(id),
  verified_at    timestamptz,
  unique (project_id, snag_no)
);
create index on snags (project_id, status);

create table handovers (
  project_id      text primary key references projects(id) on delete cascade,
  no              text not null unique,                     -- HO-00001
  date            date not null,
  status          text not null default 'draft' check (status in ('draft','signed')),
  client_rep      text not null default '',
  company_rep_id  text references users(id),
  defects_months  int not null default 12,
  outstanding     text not null default '',                 -- works or snags the client accepted as outstanding
  notes           text not null default '',
  snags_open      int not null default 0,                   -- snags not yet verified when the certificate was signed
  signed_by       text references users(id),
  signed_at       timestamptz,
  created_by      text references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
