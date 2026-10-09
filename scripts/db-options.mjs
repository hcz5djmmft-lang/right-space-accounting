// Connection options shared by the scripts; src/lib/db.ts applies the same rules for the app.
// Supabase requires TLS and its transaction pooler (port 6543) has no prepared statements; a local Postgres has neither.
export const dbOptions = url => ({
  onnotice: () => {},
  prepare: !/:6543\b/.test(url),
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url) ? false : 'require',
});
