-- Tenders: BOQ per trade, bidders and their prices, award per trade, client price.
-- Same model as the old app (tenders/{id} + trades subcollection), normalised into tables.

create table tenders (
  id          text primary key default gen_random_uuid()::text,
  no          text not null unique,                      -- TND-0001
  name        text not null,
  client_id   text references parties(id),
  client_name text not null default '',                  -- when the client is not a customer yet
  location    text not null default '',
  due_date    date,
  status      text not null default 'Draft' check (status in ('Draft','Pricing','Submitted','Won','Lost')),
  type        text, service text, unit text,
  rates       jsonb not null default '{}',               -- currency -> EGP rate, e.g. {"EUR": 60}
  markup      numeric(8,2),                              -- default markup %, null = 0
  vat         numeric(5,2) not null default 14,
  notes       text not null default '',
  project_id  text references projects(id),              -- cost center created when won
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);

create table tender_trades (
  id              text primary key default gen_random_uuid()::text,
  tender_id       text not null references tenders(id) on delete cascade,
  position        int not null default 0,
  trade_no        text,
  name            text not null,
  division        text not null default '',
  markup          numeric(8,2),                          -- per-trade markup %, null = tender default
  selected_bidder text                                   -- award; null = lowest offer
);
create index on tender_trades (tender_id, position);

create table tender_items (
  id          text primary key default gen_random_uuid()::text,
  trade_id    text not null references tender_trades(id) on delete cascade,
  position    int not null default 0,
  no          text not null default '',
  code        text,
  description text not null default '',
  unit        text not null default '',
  qty         numeric(18,3),
  act_qty     numeric(18,3)
);
create index on tender_items (trade_id, position);

create table tender_bidders (
  id        text primary key default gen_random_uuid()::text,
  trade_id  text not null references tender_trades(id) on delete cascade,
  position  int not null default 0,
  name      text not null default '',
  party_id  text references parties(id),
  currency  text not null default 'EGP',
  wastage   numeric(8,2),
  discount  numeric(8,2),
  tax       numeric(8,2)
);
create index on tender_bidders (trade_id, position);

create table tender_prices (
  bidder_id text not null references tender_bidders(id) on delete cascade,
  item_id   text not null references tender_items(id) on delete cascade,
  offer     numeric(18,4) not null,
  logistics numeric(18,4),
  misc      numeric(18,4),
  primary key (bidder_id, item_id)
);
