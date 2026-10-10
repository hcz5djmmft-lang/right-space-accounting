import { describe, expect, it } from 'vitest';
import { databaseUrlProblem, describeDatabaseUrl, hasPasswordPlaceholder, resolveDatabaseUrl } from '../scripts/db-url.mjs';

const line = 'postgresql://postgres.abc:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

describe('database line', () => {
  it('fills the Supabase placeholder from DATABASE_PASSWORD, encoding any character', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: line, DATABASE_PASSWORD: 'p#ss@w:rd/?% ' }))
      .toBe('postgresql://postgres.abc:p%23ss%40w%3Ard%2F%3F%25@aws-1-eu-central-1.pooler.supabase.com:5432/postgres');
    expect(resolveDatabaseUrl({ DATABASE_URL: ` ${line}\n`, DATABASE_PASSWORD: 'abc' })).toBe(line.replace('[YOUR-PASSWORD]', 'abc'));
  });
  it('puts DATABASE_PASSWORD in whether the line has a user alone or another password', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://postgres.abc@host:5432/postgres', DATABASE_PASSWORD: 'abc' }))
      .toBe('postgresql://postgres.abc:abc@host:5432/postgres');
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://postgres.abc:wrong@host:5432/postgres', DATABASE_PASSWORD: 'abc' }))
      .toBe('postgresql://postgres.abc:abc@host:5432/postgres');
  });
  it('leaves the line alone without DATABASE_PASSWORD, and a line it cannot read', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: line })).toBe(line);
    expect(resolveDatabaseUrl({ DATABASE_URL: '5432', DATABASE_PASSWORD: 'abc' })).toBe('5432');
    expect(resolveDatabaseUrl({})).toBe('');
  });
  it('tells a whole line from a fragment', () => {
    expect(databaseUrlProblem(line)).toBeNull();
    expect(databaseUrlProblem('postgres://postgres@localhost:5432/rsa')).toBeNull();
    expect(databaseUrlProblem('5432')).toBe('is not a whole connection line');
    expect(databaseUrlProblem('aws-1-eu-central-1.pooler.supabase.com:5432')).toBe('does not start with postgresql://');
    expect(databaseUrlProblem('psql -h host -p 5432 -d postgres -U postgres.abc')).toBe('is not a whole connection line');
    expect(databaseUrlProblem('postgresql://postgres.abc:a#b@host:5432/postgres')).toBe('is not a whole connection line');
    expect(databaseUrlProblem('postgresql://')).toBe('has no host');
  });
  it('describes the shape of a line without printing it', () => {
    expect(hasPasswordPlaceholder(line)).toBe(true);
    const d = describeDatabaseUrl(line);
    expect(d).toContain(`${line.length} characters`);
    expect(d).toContain('starts with postgresql://: yes');
    expect(d).toContain('still has [YOUR-PASSWORD]: yes');
    expect(d).not.toContain('postgres.abc');
    expect(describeDatabaseUrl('5432')).toContain('starts with postgresql://: no');
  });
});
