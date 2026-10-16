'use server';
import { redirect } from 'next/navigation';
import { logout } from '@/lib/auth';

/** Sign out (the side menu, the phone's More page and Home). */
export async function signOutAction() {
  await logout();
  redirect('/login');
}
