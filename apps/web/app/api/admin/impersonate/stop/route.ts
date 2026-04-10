import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/admin/impersonate/stop
 *
 * Ends admin impersonation and restores the admin's original session.
 */
export async function POST() {
  const cookieStore = await cookies();

  const adminSession = cookieStore.get('harbor-admin-session')?.value;
  if (!adminSession) {
    return NextResponse.json({ message: 'No admin session to restore' }, { status: 400 });
  }

  // Restore the admin's session
  cookieStore.set('harbor-session', adminSession, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  // Clear the backup cookie
  cookieStore.delete('harbor-admin-session');

  return NextResponse.json({ ok: true, message: 'Impersonation ended — you are back to your admin account.' });
}
