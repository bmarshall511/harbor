import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { serializeFile } from '@/lib/file-dto';
import { applyIgnoreFilter } from '@/lib/file-filters';

/**
 * GET /api/collections/:id/expanded
 *
 * Returns a collection along with its items fully hydrated into
 * file/folder rows so the dedicated /collections/:id page can render
 * them in the same FileGrid + FolderCards the rest of the app uses.
 *
 * Mirrors the shape of /api/favorites/expanded so the page-level
 * code can stay symmetric. PENDING_DELETE / DELETED files are
 * filtered out — a collection of soft-deleted items would otherwise
 * leak hidden state into the UI.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const collection = await db.collection.findUnique({
    where: { id },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });
  if (!collection || collection.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const fileIds = collection.items.filter((i) => i.entityType === 'FILE').map((i) => i.entityId);
  const folderIds = collection.items.filter((i) => i.entityType === 'FOLDER').map((i) => i.entityId);

  const fileRows = fileIds.length > 0
    ? await db.file.findMany({
        where: {
          id: { in: fileIds },
          status: { notIn: ['DELETED', 'PENDING_DELETE'] },
        },
        include: {
          tags: { include: { tag: true } },
          previews: { where: { size: 'THUMBNAIL' } },
        },
      })
    : [];
  const visibleFiles = await applyIgnoreFilter(fileRows);

  const folderRows = folderIds.length > 0
    ? await db.folder.findMany({ where: { id: { in: folderIds } } })
    : [];

  // Preserve the collection's `addedAt` ordering (newest first) so
  // the user always sees the items in the order they curated them in.
  const itemOrder = new Map(collection.items.map((i, idx) => [`${i.entityType}:${i.entityId}`, idx]));
  const sortedFiles = [...visibleFiles].sort(
    (a, b) => (itemOrder.get(`FILE:${a.id}`) ?? 0) - (itemOrder.get(`FILE:${b.id}`) ?? 0),
  );
  const sortedFolders = [...folderRows].sort(
    (a, b) => (itemOrder.get(`FOLDER:${a.id}`) ?? 0) - (itemOrder.get(`FOLDER:${b.id}`) ?? 0),
  );

  return NextResponse.json({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    color: collection.color,
    isPrivate: (collection as unknown as { isPrivate?: boolean }).isPrivate ?? false,
    files: sortedFiles.map((f) => serializeFile(f)),
    folders: sortedFolders,
    total: sortedFiles.length + sortedFolders.length,
  });
}
