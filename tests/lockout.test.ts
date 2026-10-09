import { describe, expect, it } from 'vitest';
import { afterFailure, isLocked, LOCK_MINUTES, MAX_FAILED } from '@/lib/lockout';

describe('login lockout', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  it('counts wrong passwords and locks at the limit', () => {
    let state = { failed: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < MAX_FAILED; i++) {
      state = afterFailure(state.failed, state.lockedUntil, now);
      expect(state).toEqual({ failed: i, lockedUntil: null });
    }
    state = afterFailure(state.failed, state.lockedUntil, now);
    expect(state.failed).toBe(MAX_FAILED);
    expect(state.lockedUntil).toEqual(new Date(now.getTime() + LOCK_MINUTES * 60_000));
    expect(isLocked(state.lockedUntil, now)).toBe(true);
    expect(isLocked(state.lockedUntil, new Date(now.getTime() + LOCK_MINUTES * 60_000 + 1))).toBe(false);
  });
  it('starts counting again once the lock has expired', () => {
    const expired = new Date(now.getTime() - 1);
    expect(afterFailure(MAX_FAILED, expired, now)).toEqual({ failed: 1, lockedUntil: null });
    expect(isLocked(null, now)).toBe(false);
  });
});
