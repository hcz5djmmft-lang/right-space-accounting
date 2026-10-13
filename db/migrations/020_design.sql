-- The design phase: drawing sets (Main Concept 2D and 3D, Shop drawings) approved by the head of design, the technical office
-- head and the director of engineering, with a group chat per set, a drawing register with revisions and the issued-for-
-- construction stamp, the client's approval of the concept, and the finishes and materials list (Adel, 2026-10-13).

alter table projects add column design_fee numeric(18,2);   -- what the client pays for the design, against the design hours' cost

create table drawing_sets (
  id             text primary key default gen_random_uuid()::text,
  project_id     text not null references projects(id) on delete cascade,
  kind           text not null check (kind in ('concept_2d','concept_3d','shop')),
  version        int not null default 1,                  -- goes up each time the set is reopened for revision
  status         text not null default 'draft' check (status in ('draft','design_head','to_head','director','approved','client','client_approved','ifc','rejected')),
  designer_id    text references users(id),
  created_by     text references users(id),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  step_at        timestamptz not null default now(),      -- when the set reached its current step (days waiting)
  design_head_by text references users(id), design_head_at timestamptz,
  to_head_by     text references users(id), to_head_at timestamptz,
  director_by    text references users(id), director_at timestamptz,
  decision_note  text not null default '',
  client_sent_at timestamptz,
  client_note    text not null default '',
  client_at      timestamptz,
  client_by      text references users(id),
  ifc_at         timestamptz,
  ifc_by         text references users(id)
);
create index on drawing_sets (project_id, kind);
create index on drawing_sets (status);

-- The register: one row per drawing and revision; files are attachments of the row (entity 'drawing').
create table drawings (
  id         text primary key default gen_random_uuid()::text,
  set_id     text not null references drawing_sets(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  no         text not null,
  title      text not null,
  rev        int not null default 1,
  superseded boolean not null default false,
  issued_on  date,
  note       text not null default '',
  created_by text references users(id),
  created_at timestamptz not null default now()
);
create unique index drawings_no_rev on drawings (set_id, no, rev);
create index on drawings (project_id);

create table set_messages (
  id      bigserial primary key,
  set_id  text not null references drawing_sets(id) on delete cascade,
  user_id text references users(id),
  text    text not null,
  at      timestamptz not null default now()
);
create index on set_messages (set_id, at);

-- Finishes and materials chosen with the client, per project.
create table finishes (
  id         text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  area       text not null,
  item       text not null,
  material   text not null default '',
  ref        text not null default '',
  status     text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  note       text not null default '',
  created_by text references users(id),
  created_at timestamptz not null default now(),
  decided_by text references users(id),
  decided_at timestamptz
);
create index on finishes (project_id);
