import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { toProviderPath } from '@/lib/provider-paths';
import { isCloudMode } from '@/lib/deployment';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  // Local filesystem
  if (root.providerType === 'LOCAL_FILESYSTEM') {
    if (isCloudMode) {
      return NextResponse.json({ message: 'Local archives not available in cloud mode' }, { status: 501 });
    }
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(root.rootPath, file.path);
    try {
      const data = await fs.readFile(fullPath);
      return new NextResponse(data, {
        headers: {
          'Content-Type': file.mimeType ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file.name}"`,
          'Content-Length': String(data.length),
        },
      });
    } catch {
      return NextResponse.json({ message: 'File not found on disk' }, { status: 404 });
    }
  }

  // Dropbox
  if (root.providerType === 'DROPBOX') {
    try {
      const token = await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!token) return NextResponse.json({ message: 'Dropbox not connected' }, { status: 401 });

      const appKey = await getSecret('dropbox.appKey') ?? '';
      const appSecret = await getSecret('dropbox.appSecret') ?? '';
      const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
      const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

      const provider = new DropboxProvider('download', 'Download', {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? undefined,
        appKey, appSecret, pathRoot,
      });

      const dropboxPath = toProviderPath(file.path, { providerType: root.providerType, rootPath: root.rootPath });
      const data = await provider.readFile(dropboxPath);
      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': file.mimeType ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file.name}"`,
          'Content-Length': String(data.length),
        },
      });
    } catch {
      return NextResponse.json({ message: 'Failed to download from Dropbox' }, { status: 502 });
    }
  }

  return NextResponse.json({ message: 'Provider not supported' }, { status: 501 });
}
