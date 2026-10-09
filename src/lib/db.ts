import postgres from 'postgres';

const g = globalThis as unknown as { __sql?: postgres.Sql };
const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa';
const serverless = !!process.env.VERCEL;
if (!process.env.DATABASE_URL && serverless) console.error('DATABASE_URL is not set: add it under Settings → Environment Variables in Vercel and redeploy.');
// Supabase requires TLS and its transaction pooler (port 6543) has no prepared statements; a local Postgres has neither.
// scripts/db-options.mjs applies the same rules for the command-line scripts.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);

export const sql: postgres.Sql =
  g.__sql ??
  postgres(url, {
    onnotice: () => {},
    // on Vercel each function instance keeps a couple of connections; the Supabase pooler multiplexes them
    max: serverless ? 2 : 5,
    idle_timeout: serverless ? 20 : undefined,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    prepare: !/:6543\b/.test(url),
    types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
  });
if (process.env.NODE_ENV !== 'production') g.__sql = sql;

export type Tx = postgres.TransactionSql | postgres.Sql;
