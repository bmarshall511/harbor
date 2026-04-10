import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthServiceForRoute } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ message: 'Username and password required' }, { status: 400 });
    }

    const authService = await getAuthServiceForRoute();
    const session = await authService.login(username, password);
    if (!session) {
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set('harbor-session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });

    return NextResponse.json({ userId: session.userId, expiresAt: session.expiresAt.toISOString() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
