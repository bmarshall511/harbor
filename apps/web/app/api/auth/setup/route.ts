import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@harbor/database';
import { getAuthServiceForRoute } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

/**
 * GET /api/auth/setup — Check if first-admin setup is needed.
 * POST /api/auth/setup — Create the first admin user (one-time bootstrap).
 */

export async function GET() {
  const authMode = await getSetting('auth.mode');
  if (authMode !== 'multi') {
    return NextResponse.json({ needsSetup: false, reason: 'local-mode' });
  }

  // Check if any non-local users exist
  const realUserCount = await db.user.count({ where: { isLocalUser: false } });
  return NextResponse.json({ needsSetup: realUserCount === 0 });
}

export async function POST(request: Request) {
  const authMode = await getSetting('auth.mode');
  if (authMode !== 'multi') {
    return NextResponse.json({ message: 'Setup only available in multi-user mode' }, { status: 403 });
  }

  // Only allow if no non-local users exist yet
  const realUserCount = await db.user.count({ where: { isLocalUser: false } });
  if (realUserCount > 0) {
    return NextResponse.json({ message: 'Setup already completed. Use login instead.' }, { status: 403 });
  }

  const { username, displayName, password } = await request.json();
  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
  }

  const authService = await getAuthServiceForRoute();
  const session = await authService.register({
    username: username.trim(),
    displayName: (displayName || username).trim(),
    password,
  });

  // Assign OWNER role to the first user
  const ownerRole = await db.role.findFirst({ where: { systemRole: 'OWNER' } });
  if (ownerRole) {
    await db.userRoleAssignment.create({
      data: { userId: session.userId, roleId: ownerRole.id },
    });
  }

  const cookieStore = await cookies();
  cookieStore.set('harbor-session', session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });

  return NextResponse.json({ userId: session.userId }, { status: 201 });
}
