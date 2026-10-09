-- Tasks: follow-ups and month-end steps for the team, optionally linked to a document.

create table tasks (
  id          text primary key default gen_random_uuid()::text,
  title       text not null,
  details     text not null default '',
  status      text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority    text not null default 'normal' check (priority in ('low','normal','high')),
  due         date,
  assignee_id text references users(id),
  link_type   text,          -- entry | payment-request | sales-invoice | cost-center
  link_id     text,
  link_label  text,
  created_by  text references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index on tasks (assignee_id, status);

create table task_comments (
  id      bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  user_id text references users(id),
  at      timestamptz not null default now(),
  text    text not null
);
