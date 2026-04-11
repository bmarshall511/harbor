import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { randomUUID } from 'node:crypto';

/**
 * POST /api/admin/impersonate — Login as another user.
 * Body: { userId: string }
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
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      userAgent: request.headers.get('user-agent') ?? null,
    },
  });

  // Get the admin's current session token from the cookie
  const currentSession = request.headers.get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('harbor-session='))
    ?.split('=')[1];

  const isSecure = process.env.NODE_ENV === 'production';
  const cookieOpts = `; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;

  const response = NextResponse.json({
    ok: true,
    impersonating: { id: targetUser.id, username: targetUser.username, displayName: targetUser.displayName },
  });

  // Save the admin's session as a backup cookie
  if (currentSession) {
    response.headers.append('Set-Cookie', `harbor-admin-session=${currentSession}${cookieOpts}`);
  }

  // Set the new impersonated session cookie
  response.headers.append('Set-Cookie', `harbor-session=${token}${cookieOpts}`);

  return response;
}
