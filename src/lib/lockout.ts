/** Login lockout: after MAX_FAILED wrong passwords in a row the login is refused for LOCK_MINUTES. */
export const MAX_FAILED = 10, LOCK_MINUTES = 15;

export const isLocked = (lockedUntil: Date | null, now = new Date()) => !!lockedUntil && lockedUntil > now;

/** The counter and lock after one more wrong password. Once a lock has expired the count starts again at 1. */
export function afterFailure(failed: number, lockedUntil: Date | null, now = new Date()) {
  const n = lockedUntil && lockedUntil <= now ? 1 : failed + 1;
  return { failed: n, lockedUntil: n >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null };
}
