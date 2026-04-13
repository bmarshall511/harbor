import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { isTextMime, isPdfMime } from '@harbor/utils';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

/**
 * GET /api/files/:id/content — Serve the raw text content of a file for inline preview.
 * Only serves text-like files (text/*, application/json, application/xml) up to 500KB.
 * For PDFs, returns basic page count info if available.
 * Supports both local filesystem and Dropbox files.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  const maxSize = 512 * 1024; // 500KB

  // Text files: serve content up to 500KB
  if (isTextMime(file.mimeType)) {
    try {
      let content: string;
      let totalSize: number;

      if (root.providerType === 'LOCAL_FILESYSTEM') {
        const fullPath = path.resolve(root.rootPath, file.path);
        const stat = await fs.stat(fullPath);
        totalSize = stat.size;
        content = await fs.readFile(fullPath, 'utf-8');
      } else if (root.providerType === 'DROPBOX') {
        // Download text content from Dropbox
        const provider = await createDropboxProvider(root, auth.userId);
        if (!provider) {
          return NextResponse.json({ message: 'Dropbox not connected' }, { status: 401 });
        }
        const dropboxPath = `${root.rootPath === '/' ? '' : root.rootPath}/${file.path}`;
        const buffer = await provider.readFile(dropboxPath);
        totalSize = buffer.length;
        content = buffer.toString('utf-8');
      } else {
        return NextResponse.json({ message: 'Unsupported provider' }, { status: 501 });
      }

      const truncated = totalSize > maxSize;
      const text = truncated ? content.slice(0, maxSize) : content;

      return NextResponse.json({
        type: 'text',
        content: text,
        truncated,
        totalSize,
        mimeType: file.mimeType,
      });
    } catch (err) {
      console.error('[Content] Failed to read text file:', err);
      return NextResponse.json({ message: 'File not readable' }, { status: 404 });
    }
  }

  // PDF: return page count info
  if (isPdfMime(file.mimeType)) {
    const meta = (file.meta as { fields?: Record<string, unknown> } | null) ?? null;
    const pageCount = (meta?.fields?.pageCount as number | undefined) ?? null;
    return NextResponse.json({
      type: 'pdf',
      pageCount,
      size: Number(file.size),
      mimeType: file.mimeType,
    });
  }

  return NextResponse.json({ message: 'Content preview not available for this file type' }, { status: 404 });
}

async function createDropboxProvider(
  root: { id: string; rootPath: string },
  userId: string,
): Promise<DropboxProvider | null> {
  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  if (!appKey || !appSecret) return null;

  const token = await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX', userId },
    orderBy: { updatedAt: 'desc' },
  }) ?? await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX' },
    orderBy: { updatedAt: 'desc' },
  });

  if (!token) return null;

  const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
  const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

  const provider = new DropboxProvider(root.id, 'Content', {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? undefined,
    appKey,
    appSecret,
    pathRoot,
  });

  provider.onTokenRefresh = async (newToken, expiresIn) => {
    await db.providerToken.update({
      where: { id: token.id },
      data: { accessToken: newToken, expiresAt: new Date(Date.now() + expiresIn * 1000) },
    });
  };

  return provider;
}
