import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware for auth route protection.
 *
 * In local mode, the session cookie is auto-created on first API call,
 * so we just check for cookie presence. Real auth validation happens
 * server-side in requireAuth().
 *
 * In multi-user mode, users without a session cookie are redirected to /login.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths — no auth required
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/api/events' // SSE needs to handle its own auth
  ) {
    return NextResponse.next();
  }

  // API routes handle their own auth via requireAuth()
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For app routes: check for session cookie
  const sessionToken = request.cookies.get('harbor-session')?.value;
  if (!sessionToken) {
    // No cookie — redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
