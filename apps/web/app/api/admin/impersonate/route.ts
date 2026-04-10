import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { randomUUID } from 'node:crypto';

/**
 * POST /api/admin/impersonate
 *
 * Allows an admin to "Login as" another user. Creates a new session
 * for the target user and sets it as the active session cookie.
 * The admin's original session is preserved in a separate cookie
 * so they can switch back.
 *
 * Body: { userId: string }
 *
 * POST /api/admin/impersonate/stop — ends impersonation and restores
 * the admin's original session.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ message: 'userId required' }, { status: 400 });

  const targetUser = await db.user.findUnique({ where: { id: userId } });
  if (!targetUser) return NextResponse.json({ message: 'User not found' }, { status: 404 });

  // Create a session for the target user
  const token = randomUUID();
  await db.session.create({
    data: {
      userId: targetUser.id,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      userAgent: request.headers.get('user-agent') ?? null,
    },
  });

  const cookieStore = await cookies();

  // Save the admin's current session so we can restore it later
  const currentSession = cookieStore.get('harbor-session')?.value;
  if (currentSession) {
    cookieStore.set('harbor-admin-session', currentSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
  }

  // Set the impersonated session
  cookieStore.set('harbor-session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  });

  return NextResponse.json({
    ok: true,
    impersonating: { id: targetUser.id, username: targetUser.username, displayName: targetUser.displayName },
  });
}
