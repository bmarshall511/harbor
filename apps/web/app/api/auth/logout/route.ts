import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthServiceForRoute } from '@/lib/auth';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get('harbor-session')?.value;

  if (token) {
    const authService = await getAuthServiceForRoute();
    await authService.logout(token);
    cookieStore.delete('harbor-session');
  }

  return NextResponse.json({ ok: true });
}
