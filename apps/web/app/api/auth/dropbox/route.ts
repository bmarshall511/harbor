import { NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * GET /api/auth/dropbox — Redirect user to Dropbox OAuth authorization page.
 * The redirect_uri is derived from the current request URL so it always matches
 * the actual server address, regardless of port or hostname.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  const appKey = await getSecret('dropbox.appKey');
  if (!appKey) {
    return NextResponse.json(
      { message: 'Dropbox not configured. Add your Dropbox App Key in Settings.' },
      { status: 503 },
    );
  }

  // Derive redirect_uri from the request URL so it matches the actual server
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/dropbox/callback`;

  const params = new URLSearchParams({
    client_id: appKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    token_access_type: 'offline',
  });

  const authUrl = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
