-- Arabic (improvement 3): each person's language. Empty until they pick one (on the sign-in page or My account).
alter table users add column lang text check (lang in ('en', 'ar'));
