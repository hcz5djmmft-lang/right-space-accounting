import postgres from 'postgres';

const g = globalThis as unknown as { __sql?: postgres.Sql };
const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa';
const serverless = !!process.env.VERCEL;
if (!process.env.DATABASE_URL && serverless) console.error('DATABASE_URL is not set: add it under Settings → Environment Variables in Vercel and redeploy.');
// Supabase requires TLS and its transaction pooler (port 6543) has no prepared statements; a local Postgres has neither.
// scripts/db-options.mjs applies the same rules for the command-line scripts.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
// The transaction pooler loses replies when the driver pipelines queries onto a busy connection (porsager/postgres
// issue 970), so a page that asks several things at once can wait forever. The Session pooler (port 5432) does not
// have this problem and is the line to use; on 6543 the pool is kept wide so pipelining rarely starts.
const transactionPooler = /:6543\b/.test(url);
if (serverless && transactionPooler) console.warn('db: DATABASE_URL uses the transaction pooler (port 6543); pages can stall. Use the Session pooler line (port 5432) from Supabase → Connect.');

export const sql: postgres.Sql =
  g.__sql ??
  postgres(url, {
    onnotice: () => {},
    // on Vercel each function instance keeps a couple of connections; the Supabase pooler multiplexes them
    max: serverless ? (transactionPooler ? 10 : 2) : 5,
    idle_timeout: serverless ? 20 : undefined,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    prepare: !transactionPooler,
    // on Vercel every statement (text only, never the values) and every connection event goes to Logs,
    // so a database that stops answering shows exactly where the request stopped
    debug: serverless ? (_c, q) => console.log('db:', q.replace(/\s+/g, ' ').trim().slice(0, 100)) : undefined,
    onclose: serverless ? (id: number) => console.log('db: connection', id, 'closed') : undefined,
    types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
  });
if (process.env.NODE_ENV !== 'production') g.__sql = sql;

export type Tx = postgres.TransactionSql | postgres.Sql;
