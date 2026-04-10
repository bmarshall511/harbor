import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { toProviderPath } from '@/lib/provider-paths';
import { isCloudMode } from '@/lib/deployment';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const size = searchParams.get('size') ?? 'THUMBNAIL';

  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // Try cached preview first (works for both local and Dropbox)
  const preview = file.previews.find((p) => p.size === size);
  if (preview) {
    try {
      const data = await fs.readFile(preview.path);
      return new NextResponse(data, {
        headers: {
          'Content-Type': `image/${preview.format}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      // Cached preview file missing, fall through
    }
  }

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  // Only images have uncached fallback paths; videos require generated thumbnails
  if (!file.mimeType?.startsWith('image/') && !file.mimeType?.startsWith('video/')) {
    return NextResponse.json({ message: 'No preview available' }, { status: 404 });
  }

  // Local filesystem: serve original image from disk (videos already handled by cached preview above)
  // Cloud mode has no local filesystem access — skip entirely.
  if (root.providerType === 'LOCAL_FILESYSTEM' && isCloudMode) {
    return NextResponse.json({ message: 'Local archives not available in cloud mode' }, { status: 501 });
  }
  if (root.providerType === 'LOCAL_FILESYSTEM' && file.mimeType?.startsWith('image/')) {
    try {
      const fullPath = path.resolve(root.rootPath, file.path);
      if (!fullPath.startsWith(root.rootPath)) {
        return NextResponse.json({ message: 'Path traversal denied' }, { status: 403 });
      }
      const data = await fs.readFile(fullPath);
      return new NextResponse(data, {
        headers: {
          'Content-Type': file.mimeType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      return NextResponse.json({ message: 'Image file not found on disk' }, { status: 404 });
    }
  }

  // Dropbox: fetch thumbnail via provider API (supports both images and videos)
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

      const provider = new DropboxProvider('preview', 'Preview', {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? undefined,
        appKey,
        appSecret,
        pathRoot,
      });

      // Canonical `file.path` is root-relative. Dropbox needs the
      // absolute in-account path, so we rebuild it from the archive
      // root's `rootPath`.
      const dropboxPath = toProviderPath(file.path, { providerType: root.providerType, rootPath: root.rootPath });

      console.log(`[Preview] Dropbox path for ${file.name}: "${dropboxPath}" (stored: "${file.path}", rootPath: "${root.rootPath}")`);

      // Try Dropbox thumbnail API first (faster, smaller)
      if (provider.getThumbnail) {
        const sizeMap: Record<string, 'thumbnail' | 'small' | 'medium' | 'large'> = {
          THUMBNAIL: 'thumbnail',
          SMALL: 'small',
          MEDIUM: 'medium',
          LARGE: 'large',
          FULL: 'large',
        };
        const thumb = await provider.getThumbnail(dropboxPath, { size: sizeMap[size] ?? 'thumbnail' });
        if (thumb) {
          return new NextResponse(new Uint8Array(thumb), {
            headers: {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }

      // For images only: fall back to full file download. For videos
      // and other types, downloading the full file as a "preview" is
      // too expensive — return 404 so the UI shows a placeholder.
      if (file.mimeType?.startsWith('image/')) {
        const data = await provider.readFile(dropboxPath);
        return new NextResponse(new Uint8Array(data), {
          headers: {
            'Content-Type': file.mimeType,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
      return NextResponse.json({ message: 'No preview available' }, { status: 404 });
    } catch (err) {
      console.error('Dropbox preview error:', err);
      return NextResponse.json({ message: 'Failed to load Dropbox preview' }, { status: 502 });
    }
  }

  return NextResponse.json({ message: 'No preview available for this provider' }, { status: 404 });
}
