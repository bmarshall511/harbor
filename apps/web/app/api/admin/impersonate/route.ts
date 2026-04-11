import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { randomUUID } from 'node:crypto';

/**
 * POST /api/admin/impersonate — Login as another user.
 *
 * Returns a redirect URL that the client should navigate to.
 * The redirect URL is a GET endpoint that sets the session cookie
 * via a proper HTTP redirect response — this is more reliable than
 * setting cookies via fetch() Set-Cookie headers.
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

  // Store the admin's current session and the new token in a temporary
  // record so the GET redirect can set both cookies in one response.
  const currentSession = request.headers.get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('harbor-session='))
    ?.split('=')[1];

  // Store in a temp table or just pass via URL-safe encoding
  // For simplicity, encode both tokens in the redirect URL
  const payload = Buffer.from(JSON.stringify({
    newToken: token,
    adminToken: currentSession ?? '',
  })).toString('base64url');

  return NextResponse.json({
    ok: true,
    redirectUrl: `/api/admin/impersonate/activate?p=${payload}`,
  });
}
