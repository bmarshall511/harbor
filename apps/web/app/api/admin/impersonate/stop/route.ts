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

  const isSecure = url.protocol === 'https:';
  const cookieOpts = `; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${isSecure ? '; Secure' : ''}`;

  const response = NextResponse.redirect(new URL('/settings?s=users', request.url));
  response.headers.append('Set-Cookie', `harbor-session=${adminSession}${cookieOpts}`);
  response.headers.append('Set-Cookie', `harbor-admin-session=; HttpOnly; Path=/; Max-Age=0`);
  return response;
}
