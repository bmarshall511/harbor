import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * GET /api/auth/dropbox/callback — Handle Dropbox OAuth callback.
 * Exchanges the authorization code for tokens and stores them.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?dropbox=error&reason=' + encodeURIComponent(error), request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?dropbox=error&reason=no_code', request.url));
  }

  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  // Derive redirect_uri from request URL (must match what was sent in the auth request)
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/dropbox/callback`;

  if (!appKey || !appSecret) {
    return NextResponse.redirect(new URL('/settings?dropbox=error&reason=not_configured', request.url));
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: appKey,
        client_secret: appSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Dropbox token exchange failed:', err);
      return NextResponse.redirect(new URL('/settings?dropbox=error&reason=token_exchange', request.url));
    }

    const tokens = await tokenRes.json();

    // Fetch account info to determine root namespace (critical for team/business accounts)
    let metadata: Record<string, string | null> = {};
    try {
      const accountRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: 'null',
      });
      if (accountRes.ok) {
        const account = await accountRes.json();
        metadata = {
          accountId: account.account_id,
          displayName: account.name?.display_name ?? null,
          email: account.email ?? null,
          accountType: account.account_type?.['.tag'] ?? null,
          rootNamespaceId: account.root_info?.root_namespace_id ?? null,
          homeNamespaceId: account.root_info?.home_namespace_id ?? null,
          rootInfoTag: account.root_info?.['.tag'] ?? null, // "user" or "team"
        };
      }
    } catch (e) {
      console.error('Failed to fetch Dropbox account info:', e);
    }

    // Store tokens and account metadata
    await db.providerToken.upsert({
      where: {
        userId_providerType: { userId: auth.userId, providerType: 'DROPBOX' },
      },
      create: {
        userId: auth.userId,
        providerType: 'DROPBOX',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        metadata,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        metadata,
      },
    });

    return NextResponse.redirect(new URL('/settings?dropbox=success', request.url));
  } catch (error) {
    console.error('Dropbox callback error:', error);
    return NextResponse.redirect(new URL('/settings?dropbox=error&reason=exception', request.url));
  }
}
