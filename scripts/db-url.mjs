// The database line, from DATABASE_URL and, when it is set, DATABASE_PASSWORD. src/lib/db.ts and the scripts share it.
// Supabase's Connect window shows the line with [YOUR-PASSWORD] in it. With DATABASE_PASSWORD set, that line can be
// pasted exactly as shown and the password kept in its own variable, with any character in it: it is encoded here.
const PLACEHOLDER = /\[YOUR[-_ ]PASSWORD\]/i;

export const resolveDatabaseUrl = (env = process.env) => {
  const url = (env.DATABASE_URL ?? '').trim();
  const password = (env.DATABASE_PASSWORD ?? '').trim();
  if (!url || !password) return url;
  const encoded = encodeURIComponent(password);
  if (PLACEHOLDER.test(url)) return url.replace(PLACEHOLDER, encoded);
  // a line with the user alone, or with another password typed in: the variable is the password
  const m = /^([a-z]+:\/\/)(.*)@([^@]*)$/i.exec(url);
  if (!m) return url;
  return `${m[1]}${m[2].split(':')[0]}:${encoded}@${m[3]}`;
};

export const hasPasswordPlaceholder = url => PLACEHOLDER.test(url);

// What a line looks like, without the line itself, for a build log anyone may read
export const describeDatabaseUrl = url => {
  const yn = b => (b ? 'yes' : 'no');
  return `${url.length} characters; starts with postgresql://: ${yn(/^postgres(ql)?:\/\//i.test(url))}; has @: ${yn(url.includes('@'))}; ` +
    `ends with /postgres: ${yn(/\/postgres$/.test(url))}; has spaces: ${yn(/\s/.test(url))}; still has [YOUR-PASSWORD]: ${yn(PLACEHOLDER.test(url))}`;
};

// null when the line is a whole postgresql:// address with a host, otherwise what is wrong with it
export const databaseUrlProblem = url => {
  let u;
  try { u = new URL(url); } catch { return 'is not a whole connection line'; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return 'does not start with postgresql://';
  if (!u.hostname) return 'has no host';
  return null;
};
