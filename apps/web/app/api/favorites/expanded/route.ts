import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { serializeFile } from '@/lib/file-dto';
import { applyIgnoreFilter } from '@/lib/file-filters';

/**
 * GET /api/favorites/expanded
 *
 * Returns the user's favorites with their underlying file/folder rows
 * fully hydrated, so a dedicated /favorites page can render them in
 * the same FileGrid the rest of the app uses without needing N
 * separate /files/:id requests.
 *
 * Files in `PENDING_DELETE` / `DELETED` state are filtered out — a
 * favorited file that the user later marks for deletion should
 * disappear from this view immediately, just like every other
 * user-visible listing in the app.
 *
 * The response shape mirrors `SearchResponse` so the page can reuse
 * the existing FileGrid + folder card components without bespoke
 * adapter code.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const favorites = await db.favorite.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
  });

  const fileIds = favorites.filter((f) => f.entityType === 'FILE').map((f) => f.entityId);
  const folderIds = favorites.filter((f) => f.entityType === 'FOLDER').map((f) => f.entityId);

  // Fetch files (with the joins serializeFile expects), then drop any
  // that have been hidden via PENDING_DELETE / DELETED status. We use
  // the same `applyIgnoreFilter` pass other listings use so private
  // archive roots stay invisible to users without permission.
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

  // Preserve the favorite-creation order so the most recently favorited
  // items appear first. The DB queries above don't guarantee that order
  // because they use `IN (...)`.
  const favOrder = new Map(favorites.map((f, idx) => [`${f.entityType}:${f.entityId}`, idx]));
  const sortedFiles = [...visibleFiles].sort(
    (a, b) => (favOrder.get(`FILE:${a.id}`) ?? 0) - (favOrder.get(`FILE:${b.id}`) ?? 0),
  );
  const sortedFolders = [...folderRows].sort(
    (a, b) => (favOrder.get(`FOLDER:${a.id}`) ?? 0) - (favOrder.get(`FOLDER:${b.id}`) ?? 0),
  );

  return NextResponse.json({
    files: sortedFiles.map((f) => serializeFile(f)),
    folders: sortedFolders,
    total: sortedFiles.length + sortedFolders.length,
  });
}
