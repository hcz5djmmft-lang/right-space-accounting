export function resolveDatabaseUrl(env?: { DATABASE_URL?: string; DATABASE_PASSWORD?: string }): string;
export function hasPasswordPlaceholder(url: string): boolean;
export function describeDatabaseUrl(url: string): string;
export function databaseUrlProblem(url: string): string | null;
