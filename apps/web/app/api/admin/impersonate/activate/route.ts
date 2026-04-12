import { NextResponse } from 'next/server';

/**
 * GET /api/admin/impersonate/activate?p=<payload>
 *
 * Sets the impersonation cookies via a redirect response.
 * Browsers always process Set-Cookie from navigation responses
 * (unlike fetch() where cookie handling can be unreliable).
 *
 * Uses Next.js response.cookies API instead of raw Set-Cookie
 * headers for reliable cookie setting across all deployment
 * targets (Vercel serverless, local dev, self-hosted).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = url.searchParams.get('p');
  if (!payload) return NextResponse.redirect(new URL('/', request.url));

  try {
    const { newToken, adminToken } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    );

    // Detect HTTPS from Vercel's forwarded proto or the URL itself.
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const isSecure = proto === 'https';

    const cookieOptions = {
      httpOnly: true,
      path: '/',
      sameSite: 'lax' as const,
      maxAge: 86400,
      secure: isSecure,
    };

    const response = NextResponse.redirect(new URL('/', request.url));

    // Set the impersonated session
    response.cookies.set('harbor-session', newToken, cookieOptions);

    // Save the admin's session for later restoration
    if (adminToken) {
      response.cookies.set('harbor-admin-session', adminToken, cookieOptions);
    }

    // Non-httpOnly marker so the client-side banner can detect impersonation
    response.cookies.set('harbor-impersonating', '1', {
      path: '/',
      sameSite: 'lax' as const,
      maxAge: 86400,
      secure: isSecure,
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL('/', request.url));
  }
}
