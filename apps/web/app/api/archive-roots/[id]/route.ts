import { NextResponse } from 'next/server';
import { ArchiveRootRepository, db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { isLocalMode } from '@/lib/deployment';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { getSetting } from '@/lib/settings';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const repo = new ArchiveRootRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const root = await repo.findById(id);
  if (!root) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  return NextResponse.json(root);
}

/**
 * PATCH /api/archive-roots/:id — Update archive root properties (e.g. rename).
 * Only updates the Harbor display name, not the actual source folder.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.archive_roots', 'access');
  if (denied) return denied;

  const { id } = await params;
  const before = await repo.findById(id);
  if (!before) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ message: 'Name cannot be empty' }, { status: 400 });
    if (name.length > 100) return NextResponse.json({ message: 'Name too long (max 100 characters)' }, { status: 400 });
    updateData.name = name;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ message: 'No changes provided' }, { status: 400 });
  }

  const updated = await repo.update(id, updateData);

  await audit(auth, 'update', 'FOLDER', id, { name: before.name }, { name: updated.name });
  emit('folder.updated', { archiveRootId: id, name: updated.name }, { userId: auth.userId });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/archive-roots/:id — Remove an archive root from Harbor.
 *
 * Cleanup behavior:
 * - Deletes the archive root record (Prisma cascades to folders, files,
 *   file tags, folder tags, metadata, metadata edits, previews, faces,
 *   file versions, comments, and archive root access records)
 * - Cleans up orphaned entity relations pointing to deleted files/folders
 * - Recalculates tag usage counts
 * - Deletes cached preview files from disk
 * - Does NOT delete actual source files/folders on the filesystem or cloud provider
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.archive_roots', 'access');
  if (denied) return denied;

  const { id } = await params;
  const root = await repo.findById(id);
  if (!root) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // Collect file and folder IDs before deletion (for relation cleanup)
  const fileIds = await db.file.findMany({
    where: { archiveRootId: id },
    select: { id: true },
  }).then((files) => files.map((f) => f.id));

  const folderIds = await db.folder.findMany({
    where: { archiveRootId: id },
    select: { id: true },
  }).then((folders) => folders.map((f) => f.id));

  // Collect preview paths before deletion (for disk cleanup)
  const previewPaths = await db.preview.findMany({
    where: { fileId: { in: fileIds } },
    select: { path: true },
  }).then((previews) => previews.map((p) => p.path));

  // Stop file watcher before deletion (local mode only)
  if (isLocalMode) {
    try {
      const { fileWatcher } = await import('@harbor/jobs');
      fileWatcher.unwatchRoot(id);
    } catch { /* cloud mode — no watcher */ }
  }

  // Delete the archive root — Prisma cascades to all child records
  await repo.delete(id);

  // Clean up orphaned entity relations
  if (fileIds.length > 0 || folderIds.length > 0) {
    await db.entityRelation.deleteMany({
      where: {
        OR: [
          { sourceType: 'FILE', sourceId: { in: fileIds } },
          { targetType: 'FILE', targetId: { in: fileIds } },
          { sourceType: 'FOLDER', sourceId: { in: folderIds } },
          { targetType: 'FOLDER', targetId: { in: folderIds } },
        ],
      },
    });
  }

  // Recalculate tag usage counts (tags themselves are not deleted)
  await db.$executeRaw`
    UPDATE tags SET usage_count = (
      SELECT COUNT(*) FROM file_tags WHERE file_tags.tag_id = tags.id
    ) + (
      SELECT COUNT(*) FROM folder_tags WHERE folder_tags.tag_id = tags.id
    )
  `;

  // Delete cached preview files from disk (best-effort, don't fail if files are missing)
  for (const previewPath of previewPaths) {
    try {
      await fs.unlink(previewPath);
    } catch {
      // Preview file already gone or inaccessible — fine
    }
  }

  // Try to clean up empty preview cache subdirectories
  try {
    const cacheDir = await getSetting('preview.cacheDir');
    const rootCacheDir = path.join(cacheDir, id);
    await fs.rm(rootCacheDir, { recursive: true, force: true });
  } catch {
    // Cache dir doesn't exist or can't be removed — fine
  }

  // Optionally clean up .harbor metadata files from the archive
  const { searchParams } = new URL(request.url);
  const cleanMetadata = searchParams.get('cleanMetadata') === 'true';
  if (cleanMetadata && root.providerType === 'LOCAL_FILESYSTEM' && root.rootPath) {
    try {
      // Recursively find and remove .harbor directories
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(execFile);
      await execAsync('find', [root.rootPath, '-name', '.harbor', '-type', 'd', '-exec', 'rm', '-rf', '{}', '+'], { timeout: 30000 });
    } catch {
      // Best-effort cleanup
    }
  }

  await audit(auth, 'delete', 'FOLDER', id, { name: root.name, providerType: root.providerType, rootPath: root.rootPath, fileCount: fileIds.length, folderCount: folderIds.length });
  emit('folder.deleted', { archiveRootId: id, name: root.name }, { userId: auth.userId });

  return NextResponse.json({
    removed: {
      archiveRoot: root.name,
      files: fileIds.length,
      folders: folderIds.length,
      previews: previewPaths.length,
    },
    preserved: {
      sourceFiles: true,
      description: 'Source files on disk or cloud storage were not modified.',
    },
  });
}
