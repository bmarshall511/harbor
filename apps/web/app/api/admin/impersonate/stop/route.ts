import { NextResponse } from 'next/server';

/**
 * POST /api/admin/impersonate/stop — End impersonation.
 */
export async function POST(request: Request) {
  // Read the backup admin session from the cookie
  const adminSession = request.headers.get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('harbor-admin-session='))
    ?.split('=')[1];

  if (!adminSession) {
    return NextResponse.json({ message: 'No admin session to restore' }, { status: 400 });
  }

  const isSecure = process.env.NODE_ENV === 'production';
  const cookieOpts = `; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${isSecure ? '; Secure' : ''}`;

  const response = NextResponse.json({ ok: true, message: 'Impersonation ended.' });

  // Restore the admin's session
  response.headers.append('Set-Cookie', `harbor-session=${adminSession}${cookieOpts}`);

  // Clear the backup cookie
  response.headers.append('Set-Cookie', `harbor-admin-session=; HttpOnly; Path=/; Max-Age=0`);

  return response;
}
