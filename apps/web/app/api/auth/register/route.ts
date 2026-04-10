import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@harbor/database';
import { getAuthServiceForRoute } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

export async function POST(request: Request) {
  const authMode = await getSetting('auth.mode');
  if (authMode !== 'multi') {
    return NextResponse.json({ message: 'Registration not available in local mode' }, { status: 403 });
  }

  const registrationEnabled = await getSetting('registration.enabled');
  if (registrationEnabled !== 'true') {
    return NextResponse.json({ message: 'Registration is currently disabled' }, { status: 403 });
  }

  try {
    const { username, email, displayName, password } = await request.json();
    if (!username || !displayName || !password) {
      return NextResponse.json({ message: 'username, displayName, and password are required' }, { status: 400 });
    }

    const authService = await getAuthServiceForRoute();
    const session = await authService.register({ username, email, displayName, password });

    // Assign default EDITOR role to new users
    const editorRole = await db.role.findFirst({ where: { systemRole: 'EDITOR' } });
    if (editorRole) {
      await db.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: session.userId, roleId: editorRole.id } },
        create: { userId: session.userId, roleId: editorRole.id },
        update: {},
      });
    }

    const cookieStore = await cookies();
    cookieStore.set('harbor-session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });

    return NextResponse.json({ userId: session.userId }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
