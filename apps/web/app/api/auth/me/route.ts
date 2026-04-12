import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuth, getAuthServiceForRoute } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

export async function GET(request: Request) {
  const authMode = await getSetting('auth.mode');
  const ctx = await getAuth(request);

  if (!ctx) {
    // Clear any stale session cookie so middleware stops granting access
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    const cookieStore = await cookies();
    if (cookieStore.get('harbor-session')?.value) {
      response.cookies.set('harbor-session', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    }
    return response;
  }

  // Flatten permissions from all roles, deduplicated
  const permSet = new Set<string>();
  const permissions: Array<{ resource: string; action: string }> = [];
  for (const role of ctx.roles) {
    for (const p of role.permissions) {
      const key = `${p.resource}:${p.action}`;
      if (!permSet.has(key)) {
        permSet.add(key);
        permissions.push({ resource: p.resource, action: p.action });
      }
    }
  }

  const isOwner = ctx.roles.some((r) => r.systemRole === 'OWNER');

  const response = NextResponse.json({
    authenticated: true,
    user: {
      id: ctx.userId,
      username: ctx.username,
      displayName: ctx.displayName,
      isLocalUser: ctx.isLocalUser,
      isOwner,
      roles: ctx.roles.map((r) => ({ name: r.name, systemRole: r.systemRole })),
      permissions,
    },
  });

  // In local mode, ensure a session cookie exists so middleware doesn't redirect
  if (authMode !== 'multi') {
    const cookieStore = await cookies();
    const existingToken = cookieStore.get('harbor-session')?.value;
    if (!existingToken) {
      const authService = await getAuthServiceForRoute();
      const session = await authService.createSession(ctx.userId);
      response.cookies.set('harbor-session', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: session.expiresAt,
      });
    }
  }

  return response;
}
