// Creates or updates a login. Usage:
//   DATABASE_URL=... node scripts/create-user.mjs <email> "<name>" <password> <role,role>
// Roles: management, finance, engineering, projects, tenders
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { dbOptions } from './db-options.mjs';
import { resolveDatabaseUrl } from './db-url.mjs';

const [email, name, password, roles = 'management'] = process.argv.slice(2);
if (!email || !name || !password) { console.error('Usage: create-user.mjs <email> "<name>" <password> <roles>'); process.exit(1); }
const url = resolveDatabaseUrl();
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }
const sql = postgres(url, dbOptions(url));
const hash = await bcrypt.hash(password, 10);
await sql`insert into users (email, name, password_hash, roles) values (${email.toLowerCase()}, ${name}, ${hash}, ${roles.split(',')})
  on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, roles = excluded.roles, active = true`;
console.log('Saved user', email, 'roles', roles);
await sql.end();
