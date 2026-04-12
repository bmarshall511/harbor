import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * POST /api/auth/dropbox/test — Validate Dropbox connection and root path.
 * Checks: credentials, token, token validity, scopes, path accessibility.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.dropbox', 'access');
  if (denied) return denied;

  const { rootPath } = await request.json().catch(() => ({ rootPath: '' }));
  const results: { step: string; ok: boolean; detail: string }[] = [];

  // Step 1: Check credentials
  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  if (!appKey || !appSecret) {
    results.push({ step: 'Credentials', ok: false, detail: 'Dropbox App Key or App Secret not configured. Add them in Settings.' });
    return NextResponse.json({ ok: false, results });
  }
  results.push({ step: 'Credentials', ok: true, detail: 'App Key and App Secret configured.' });

  // Step 2: Check token exists
  const token = await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX', userId: auth.userId },
    orderBy: { updatedAt: 'desc' },
  });
  if (!token) {
    results.push({ step: 'Authorization', ok: false, detail: 'No Dropbox token found. Click "Connect Dropbox" to authorize.' });
    return NextResponse.json({ ok: false, results });
  }
  results.push({ step: 'Authorization', ok: true, detail: 'Dropbox token found.' });

  // Step 3: Test by listing the root path using the actual provider
  const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
  const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

  const provider = new DropboxProvider('test', 'Test', {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? undefined,
    appKey,
    appSecret,
    pathRoot,
  });

  const testPath = rootPath && rootPath !== '/' ? rootPath : '';

  try {
    let count = 0;
    for await (const entry of provider.listDirectory(testPath)) {
      count++;
      if (count >= 3) break; // Only need to verify it works
    }
    results.push({
      step: 'Path access',
      ok: true,
      detail: `Path "${rootPath || '/'}" is accessible. Found ${count}+ item(s).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // The DropboxProvider already formats actionable error messages
    results.push({ step: 'Path access', ok: false, detail: message });
    return NextResponse.json({ ok: false, results });
  }

  return NextResponse.json({ ok: true, results });
}
