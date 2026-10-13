-- The Project Information form AF-PI-01 on every project, project phases, Engineering split into the Technical Office and
-- Site execution sections, and the org-chart positions assigned under Settings (Adel, 2026-10-13).

-- Phases: Project form > Design (skipped when the project has no design) > QS and pricing > Planning > Execution > Handover.
alter table projects add column phase text check (phase in ('form','design','qs','planning','execution','handover','closed')) default 'form';
alter table projects add column phase_at timestamptz not null default now();
alter table projects add column created_by text references users(id);
update projects set phase = 'execution' where not is_office;   -- the projects already running when this arrived
update projects set phase = null where is_office;              -- the office is not a project

create table project_phases (
  id         text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  phase      text not null,
  at         timestamptz not null default now(),
  user_id    text references users(id),
  note       text not null default ''
);
create index on project_phases (project_id, at);

-- One form per project: `data` holds the 37 answers by field key (see src/lib/project-form.ts), `notes` the Notes / Attachments
-- cell of each field. Photos, drawings and the general layout sketch are attachments of the project (tags photos, drawings, layout).
create table project_info (
  project_id   text primary key references projects(id) on delete cascade,
  rev          text not null default '',
  data         jsonb not null default '{}',
  notes        jsonb not null default '{}',
  completed_at timestamptz,
  completed_by text references users(id),
  updated_at   timestamptz not null default now(),
  updated_by   text references users(id)
);

-- Engineering has two sections; a section is a department under its parent, members get the parent's permissions too,
-- and a section with no head sends its requests to the parent's head.
alter table departments add column parent_id text references departments(id);
insert into departments (id, code, name, parent_id, roles) select 'to', 'TO', 'Technical Office', 'eng', '{engineering,projects}' where exists (select 1 from departments where id = 'eng') on conflict do nothing;
insert into departments (id, code, name, parent_id, roles) select 'site', 'SITE', 'Site execution', 'eng', '{engineering,projects}' where exists (select 1 from departments where id = 'eng') on conflict do nothing;

-- Who holds which position of the org chart (one person can hold several; some positions have several holders).
create table user_positions (
  user_id  text not null references users(id) on delete cascade,
  position text not null,
  primary key (user_id, position)
);
