'use server';
import { requireUser } from '@/lib/auth';
import { pushTo, subscribe, unsubscribe, type Subscription } from '@/lib/push';
import { RuleError } from '@/lib/ledger';

// Turning phone notifications on and off (My account, Overview) and the test message.
export async function savePushAction(sub: Subscription, device: string): Promise<string | null> {
  const user = await requireUser();
  try { await subscribe(user, sub, device); return null; }
  catch (e) { return e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Notifications are not on.'); }
}
export async function removePushAction(endpoint: string) {
  const user = await requireUser();
  await unsubscribe(user, endpoint);
}
export async function testPushAction(): Promise<number> {
  const user = await requireUser();
  return pushTo([user.id], { title: 'Right Space', body: `Notifications are on for ${user.name}.`, url: '/account', tag: 'test' });
}
