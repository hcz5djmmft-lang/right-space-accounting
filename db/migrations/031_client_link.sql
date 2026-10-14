-- Client link (improvement 2): a secret link per project that opens the client's page without a login, with their
-- invoices and progress claims, the variation orders and design concepts waiting for their answer, and the handover
-- certificate to sign. Revoking a link stops it at once; a new link is a new secret.
create table client_links (
  token        text primary key,
  project_id   text not null references projects(id) on delete cascade,
  created_by   text references users(id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   text references users(id),
  last_seen_at timestamptz
);
create unique index client_links_one_live on client_links(project_id) where revoked_at is null;
-- the client's own signature on the handover certificate, drawn on their phone
alter table handovers add column client_signature text;      -- a PNG as a data: URL
alter table handovers add column client_signed_name text;
alter table handovers add column client_signed_at timestamptz;
