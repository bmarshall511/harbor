import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * POST /api/auth/dropbox/refresh — Refresh the Dropbox access token using the refresh token.
 * This gets a new token with the current app scopes (important after scope changes).
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.dropbox', 'access');
  if (denied) return denied;

  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  if (!appKey || !appSecret) {
    return NextResponse.json({ message: 'Dropbox credentials not configured' }, { status: 400 });
  }

  const token = await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX', userId: auth.userId },
    orderBy: { updatedAt: 'desc' },
  });

  if (!token?.refreshToken) {
    return NextResponse.json({ message: 'No refresh token available. Reconnect Dropbox to get a new token.' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ message: `Dropbox refresh failed: ${errText}. Try Reconnecting Dropbox.` }, { status: 400 });
    }

    const data = await res.json();

    await db.providerToken.update({
      where: { id: token.id },
      data: {
        accessToken: data.access_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Token refreshed successfully with current app scopes.',
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
