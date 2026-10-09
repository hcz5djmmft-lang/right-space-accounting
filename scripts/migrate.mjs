// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... npm run migrate
// With --if-configured (the build on Vercel) a build without DATABASE_URL is skipped, except a production build,
// which fails with a clear message rather than going live against nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { dbOptions } from './db-options.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  if (process.argv.includes('--if-configured') && process.env.VERCEL_ENV !== 'production') { console.log('migrate: DATABASE_URL not set, skipped'); process.exit(0); }
  console.error(process.env.VERCEL ? 'migrate: DATABASE_URL is not set. Add it under Settings → Environment Variables in Vercel and redeploy.' : 'Set DATABASE_URL');
  process.exit(1);
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
