import { NextResponse } from 'next/server';
import { db, FileRepository, ArchiveRootRepository } from '@harbor/database';
import { LocalFilesystemProvider, DropboxProvider, ArchiveMetadataService } from '@harbor/providers';
import { metaRootForArchive } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { getSecret } from '@/lib/secrets';
import { toProviderPath } from '@/lib/provider-paths';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

/**
 * POST /api/admin/delete-queue/:id/approve
 *
 * Permanently delete the file:
 *   1. Remove the bytes from the provider (local FS unlink, or
 *      Dropbox files_delete_v2).
 *   2. Remove the on-disk JSON metadata file.
 *   3. Hard-delete the File row.
 *   4. Mark the DeleteRequest row APPROVED so the cumulative
 *      "bytes reclaimed" stat reflects the freed space.
 *
 * Snapshotted size on the request row is what powers the admin
 * page's "X items, Y bytes reclaimed" counter — we keep that even
 * after the file row is gone.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const req = await db.deleteRequest.findUnique({
    where: { id },
    include: { file: true, archiveRoot: true },
  });
  if (!req) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  if (req.status !== 'PENDING') {
    return NextResponse.json({ message: 'Request already resolved' }, { status: 409 });
  }

  // Best-effort: actually delete the bytes from the provider.
  // If the provider call fails we still mark the request resolved
  // and surface the error so the admin sees what happened — they
  // can manually clean up.
  let providerError: string | null = null;
  try {
    if (req.archiveRoot.providerType === 'LOCAL_FILESYSTEM') {
      // Resolve to an absolute disk path and unlink. We use the
      // provider for symmetry with future virtual local providers,
      // but a direct fs.unlink would also be correct.
      const provider = new LocalFilesystemProvider(
        req.archiveRootId,
        req.archiveRoot.name,
        req.archiveRoot.rootPath,
      );
      await provider.deleteFile(req.filePath);
    } else if (req.archiveRoot.providerType === 'DROPBOX') {
      const token = await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!token) {
        providerError = 'Dropbox not connected for the approving admin — bytes not removed.';
      } else {
        const appKey = (await getSecret('dropbox.appKey')) ?? '';
        const appSecret = (await getSecret('dropbox.appSecret')) ?? '';
        const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
        const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;
        const provider = new DropboxProvider('delete', 'Delete', {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? undefined,
          appKey,
          appSecret,
          pathRoot,
        });
        const dropboxAbsolute = toProviderPath(req.filePath, {
          providerType: req.archiveRoot.providerType,
          rootPath: req.archiveRoot.rootPath,
        });
        await provider.deleteFile(dropboxAbsolute);
      }
    }
  } catch (err) {
    providerError = err instanceof Error ? err.message : 'Provider delete failed';
  }

  // Remove the on-disk metadata JSON. Non-fatal if it fails.
  try {
    const metaRoot = metaRootForArchive(
      req.archiveRootId,
      req.archiveRoot.rootPath,
      req.archiveRoot.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
    );
    await archiveMeta.removeItem(metaRoot, req.filePath);
  } catch { /* non-fatal */ }

  // Drop any cached offline payload for the file.
  if (req.fileId) {
    try {
      const cacheDir = process.env.HARBOR_DATA_DIR
        ? path.join(process.env.HARBOR_DATA_DIR, 'preview-cache')
        : './data/preview-cache';
      const offlinePath = path.join(cacheDir, 'offline', req.fileId);
      await fsp.unlink(offlinePath).catch(() => undefined);
    } catch { /* non-fatal */ }
  }

  // Hard-delete the file row. The DeleteRequest's `fileId` becomes
  // null via the SetNull cascade — the size snapshot survives.
  if (req.fileId) {
    try { await fileRepo.hardDelete(req.fileId); } catch { /* already gone */ }
  }

  // Mark the request approved.
  await db.deleteRequest.update({
    where: { id: req.id },
    data: {
      status: 'APPROVED',
      resolvedByUserId: auth.userId,
      resolvedAt: new Date(),
    },
  });

  await audit(
    auth,
    'delete-approved',
    'FILE',
    req.fileId ?? req.id,
    { name: req.fileName, path: req.filePath, bytes: Number(req.fileSize) },
    { providerError },
  );
  if (req.fileId) {
    emit(
      'file.deleted',
      { fileId: req.fileId, path: req.filePath, archiveRootId: req.archiveRootId },
      { archiveRootId: req.archiveRootId, userId: auth.userId },
    );
  }

  return NextResponse.json({
    ok: true,
    bytesReclaimed: Number(req.fileSize),
    providerError,
  });
}
