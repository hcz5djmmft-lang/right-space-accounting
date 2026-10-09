// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... npm run migrate
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }
const sql = postgres(url, { onnotice: () => {} });
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'db', 'migrations');

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql`select name from schema_migrations`).map(r => r.name));
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  await sql.begin(async tx => {
    await tx.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
    await tx`insert into schema_migrations (name) values (${file})`;
  });
  console.log('applied', file);
}
await sql.end();
