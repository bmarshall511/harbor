import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@harbor/database';
import { getAuthServiceForRoute } from '@/lib/auth';

/**
 * GET /api/auth/dev-login — Auto-login as the first admin user (dev only).
 * Only available in development mode.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Not available in production' }, { status: 403 });
  }

  // Find the first admin/owner user
  const adminUser = await db.user.findFirst({
    where: { isLocalUser: false, isActive: true },
    include: { roleAssignments: { include: { role: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!adminUser) {
    return NextResponse.json({ message: 'No admin user found. Create one first.' }, { status: 404 });
  }

  const authService = await getAuthServiceForRoute();
  const session = await authService.createSession(adminUser.id);

  const cookieStore = await cookies();
  cookieStore.set('harbor-session', session.token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });

  // Redirect to the app
  return NextResponse.redirect(new URL('/', 'http://localhost:3000'));
}
