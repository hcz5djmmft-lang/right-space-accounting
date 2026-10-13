-- Planning (Adel, 2026-10-13, update 13): a schedule per project, one activity per work category (the Master BOQ's sections
-- by default) with planned dates, a baseline frozen when the schedule is set, weekly progress from the site engineer, delays
-- flagged as tasks, and the materials' needed-by dates handed to procurement.
create table schedules (
  project_id    text primary key references projects(id) on delete cascade,
  note          text not null default '',
  baselined_at  timestamptz,
  baselined_by  text references users(id),
  updated_by    text references users(id),
  updated_at    timestamptz not null default now()
);

create table activities (
  id           text primary key default gen_random_uuid()::text,
  project_id   text not null references projects(id) on delete cascade,
  position     int not null default 0,
  category     text not null default 'other',   -- the Master BOQ section number, or 'other'
  name         text not null,
  start_date   date,
  end_date     date,
  base_start   date,
  base_end     date,
  progress     numeric(5,2) not null default 0,
  progress_at  date,
  note         text not null default ''
);
create index on activities (project_id, position);

create table activity_progress (
  id           bigserial primary key,
  activity_id  text not null references activities(id) on delete cascade,
  week         date not null,
  pct          numeric(5,2) not null,
  note         text not null default '',
  user_id      text references users(id),
  at           timestamptz not null default now()
);
create index on activity_progress (activity_id, week);

-- a task raised for a late activity points back at it, so it is raised once
alter table tasks add column activity_id text references activities(id) on delete set null;
