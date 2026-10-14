-- Phone notifications (improvement 1): web push from the installed phone app. The signing keys are made by the app on
-- first use and kept here, so no hosting variable is needed; each phone that turns notifications on is a subscription.
create table push_keys (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
create table push_subscriptions (
  endpoint   text primary key,
  user_id    text not null references users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user on push_subscriptions(user_id);
-- what each person has already been told about (an approval, a task, a claim step), so each is pushed once
create table push_sent (
  user_id text not null references users(id) on delete cascade,
  key     text not null,
  at      timestamptz not null default now(),
  primary key (user_id, key)
);
-- runs that must happen once: the morning summary of a day, and the throttle of the pending check
create table push_runs (
  name text primary key,
  at   timestamptz not null default now()
);
-- the morning summary goes to each partner's login; Adel and Haitham are linked by name where they already have one,
-- the others are picked on the Partners page once their logins exist
alter table partners add column user_id text references users(id) on delete set null;
update partners p set user_id = (select u.id from users u where u.active and 'management' = any(u.roles)
    and lower(split_part(u.name, ' ', 1)) = lower(split_part(p.name, ' ', 1)) order by u.created_at limit 1)
  where p.user_id is null;
