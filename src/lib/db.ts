import postgres from 'postgres';

const g = globalThis as unknown as { __sql?: postgres.Sql };

export const sql: postgres.Sql =
  g.__sql ??
  postgres(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa', {
    onnotice: () => {},
    max: 5,
    types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
  });
if (process.env.NODE_ENV !== 'production') g.__sql = sql;

export type Tx = postgres.TransactionSql | postgres.Sql;
