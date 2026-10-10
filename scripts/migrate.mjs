// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... npm run migrate
// With --if-configured (the build on Vercel) a build without DATABASE_URL is skipped, except a production build,
// which fails with a clear message rather than going live against nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { dbOptions } from './db-options.mjs';
import { databaseUrlProblem, describeDatabaseUrl, hasPasswordPlaceholder, resolveDatabaseUrl } from './db-url.mjs';

const url = resolveDatabaseUrl();
const onBuild = process.argv.includes('--if-configured');
// A preview build (a branch, a pull request) never touches the database unless the Preview environment says so with
// MIGRATE_PREVIEW=1, so a variable mistakenly shared with Production cannot alter the live books from a branch, and a
// variable that exists for Production only (DATABASE_PASSWORD) cannot fail a preview build either.
if (onBuild && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.MIGRATE_PREVIEW !== '1') {
  console.log(`migrate: ${process.env.VERCEL_ENV} build without MIGRATE_PREVIEW=1, tables left as they are`); process.exit(0);
}
if (!url) {
  if (onBuild && process.env.VERCEL_ENV !== 'production') { console.log('migrate: DATABASE_URL not set, skipped'); process.exit(0); }
  console.error(process.env.VERCEL ? 'migrate: DATABASE_URL is not set. Add it under Settings → Environment Variables in Vercel and redeploy.' : 'Set DATABASE_URL');
  process.exit(1);
}
const problem = databaseUrlProblem(url);
if (problem) {
  console.error(`migrate: DATABASE_URL ${problem} (${describeDatabaseUrl(url)}). It must be the whole line from Supabase → Connect → Session pooler, ` +
    'starting with postgresql:// and ending with /postgres, pasted exactly as shown. The password goes in its own variable, DATABASE_PASSWORD.');
  process.exit(1);
}
if (hasPasswordPlaceholder(url)) {
  console.error('migrate: DATABASE_URL still has [YOUR-PASSWORD] in it. Add a second variable, DATABASE_PASSWORD, holding only the database password ' +
    '(Supabase → Project Settings → Database → Reset database password gives a new one), then redeploy.');
  process.exit(1);
}
const host = new URL(url).hostname;
if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host)) {
  console.warn(`migrate: DATABASE_URL points at ${host}. Without the IPv4 add-on that host cannot be reached from Vercel; the Session pooler or Transaction pooler line (host ending in pooler.supabase.com) always can.`);
}
if (/:6543\b/.test(url)) {
  console.warn('migrate: DATABASE_URL uses the transaction pooler (port 6543); pages can stall. Use the Session pooler line (port 5432) from Supabase → Connect.');
}
if (process.env.VERCEL_ENV) console.log(`migrate: ${process.env.VERCEL_ENV} build`);
const sql = postgres(url, { ...dbOptions(url), max: 1 });
const dir = fileURLToPath(new URL('../db/migrations', import.meta.url));

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
let applied = 0;
await sql.begin(async tx => {
  // two deploys building at the same time wait for each other instead of applying the same file twice
  await tx`select pg_advisory_xact_lock(7260001)`;
  const done = new Set((await tx`select name from schema_migrations`).map(r => r.name));
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await tx.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
    await tx`insert into schema_migrations (name) values (${file})`;
    console.log('applied', file); applied++;
  }
});
if (!applied) console.log('migrate: nothing to apply');
await sql.end();
