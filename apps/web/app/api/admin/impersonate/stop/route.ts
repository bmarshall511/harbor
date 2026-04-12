import { NextResponse } from 'next/server';

/**
 * GET /api/admin/impersonate/stop — End impersonation via redirect.
 *
 * Reads the backup admin session cookie, restores it, clears the
 * backup, and redirects to /settings?s=users.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const adminSession = request.headers.get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('harbor-admin-session='))
    ?.split('=')[1];

  if (!adminSession) {
    return NextResponse.redirect(new URL('/settings?s=users', request.url));
  }

  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const isSecure = proto === 'https';

  const response = NextResponse.redirect(new URL('/settings?s=users', request.url));

  response.cookies.set('harbor-session', adminSession, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 2592000,
    secure: isSecure,
  });
  response.cookies.set('harbor-admin-session', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('harbor-impersonating', '', {
    path: '/',
    maxAge: 0,
  });

  return response;
}
