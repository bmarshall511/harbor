import { NextResponse } from 'next/server';

/**
 * GET /api/admin/impersonate/activate?p=<payload>
 *
 * Sets the impersonation cookies via a redirect response.
 * Browsers always process Set-Cookie from navigation responses
 * (unlike fetch() where cookie handling can be unreliable).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = url.searchParams.get('p');
  if (!payload) return NextResponse.redirect(new URL('/', request.url));

  try {
    const { newToken, adminToken } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    );

    const isSecure = url.protocol === 'https:';
    const cookieOpts = `; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;

    const response = NextResponse.redirect(new URL('/', request.url));

    // Set the impersonated session
    response.headers.append('Set-Cookie', `harbor-session=${newToken}${cookieOpts}`);

    // Save the admin's session for later restoration
    if (adminToken) {
      response.headers.append('Set-Cookie', `harbor-admin-session=${adminToken}${cookieOpts}`);
    }

    return response;
  } catch {
    return NextResponse.redirect(new URL('/', request.url));
  }
}
