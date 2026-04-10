import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * POST /api/auth/dropbox/browse — List folders in Dropbox for the folder picker.
 * Body: { path: string } — Dropbox-relative path to list (empty or "/" for root)
 * Returns: { folders: [{ name, path }] }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  const { path: dirPath } = await request.json().catch(() => ({ path: '' }));

  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  if (!appKey || !appSecret) {
    return NextResponse.json({ message: 'Dropbox credentials not configured' }, { status: 400 });
  }

  const token = await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX', userId: auth.userId },
    orderBy: { updatedAt: 'desc' },
  });
  if (!token) {
    return NextResponse.json({ message: 'Dropbox not connected' }, { status: 401 });
  }

  // Extract root namespace for team/business account support
  const tokenMeta = (token.metadata ?? {}) as Record<string, unknown>;
  const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;
  const accountType = (tokenMeta.accountType as string) ?? null;
  const rootInfoTag = (tokenMeta.rootInfoTag as string) ?? null;
  const displayName = (tokenMeta.displayName as string) ?? null;

  const provider = new DropboxProvider('browse', 'Browse', {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? undefined,
    appKey,
    appSecret,
    pathRoot,
  });

  try {
    const folders: Array<{ name: string; path: string }> = [];
    for await (const entry of provider.listDirectory(dirPath || '')) {
      if (entry.isDirectory) {
        folders.push({ name: entry.name, path: entry.path });
      }
      if (folders.length >= 200) break; // Safety limit
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({
      folders,
      currentPath: dirPath || '/',
      accountInfo: {
        accountType,
        rootInfoTag,
        displayName,
        hasTeamSpace: rootInfoTag === 'team',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to browse Dropbox';
    return NextResponse.json({ message }, { status: 502 });
  }
}
