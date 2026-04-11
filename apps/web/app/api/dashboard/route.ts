import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** GET /api/dashboard — Aggregated dashboard data. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const [
      totalFiles,
      totalFolders,
      totalArchives,
      recentFiles,
      recentFavorites,
      recentCollections,
      typeCounts,
    ] = await Promise.all([
      db.file.count({ where: { status: 'INDEXED' } }),
      db.folder.count(),
      db.archiveRoot.count({ where: { isActive: true } }),
      db.file.findMany({
        where: { status: 'INDEXED' },
        orderBy: { indexedAt: 'desc' },
        take: 18,
        select: { id: true, name: true, title: true, mimeType: true, size: true, indexedAt: true,
          previews: { where: { size: 'THUMBNAIL' }, select: { id: true } },
        },
      }),
      db.favorite.findMany({
        where: { userId: auth.userId, entityType: 'FILE' },
        orderBy: { createdAt: 'desc' },
        take: 18,
      }).then(async (favs) => {
        const fileIds = favs.map((f) => f.entityId);
        if (fileIds.length === 0) return [];
        const files = await db.file.findMany({
          where: { id: { in: fileIds } },
          select: { id: true, name: true, title: true, mimeType: true, size: true,
            previews: { where: { size: 'THUMBNAIL' }, select: { id: true } },
          },
        });
        return favs.map((fav) => {
          const file = files.find((f) => f.id === fav.entityId);
          return {
            id: fav.id, entityId: fav.entityId, createdAt: fav.createdAt.toISOString(),
            name: file?.name ?? null, title: file?.title ?? null, mimeType: file?.mimeType ?? null,
            hasPreview: (file?.previews?.length ?? 0) > 0,
          };
        });
      }),
      db.collection.findMany({
        where: { userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: { _count: { select: { items: true } } },
      }),
      db.$queryRaw`
        SELECT
          CASE
            WHEN mime_type LIKE 'image/%' THEN 'Images'
            WHEN mime_type LIKE 'video/%' THEN 'Videos'
            WHEN mime_type LIKE 'audio/%' THEN 'Audio'
            WHEN mime_type LIKE 'text/%' OR mime_type = 'application/pdf' THEN 'Documents'
            ELSE 'Other'
          END as category,
          COUNT(*)::int as count
        FROM files
        WHERE status = 'INDEXED'
        GROUP BY 1
        ORDER BY count DESC
      ` as Promise<Array<{ category: string; count: number }>>,
    ]);

    return NextResponse.json({
      stats: { totalFiles, totalFolders, totalArchives },
      typeCounts,
      recentFiles: recentFiles.map((f) => ({
        id: f.id, name: f.name, title: f.title, mimeType: f.mimeType,
        size: Number(f.size), hasPreview: f.previews.length > 0,
        indexedAt: f.indexedAt?.toISOString(),
      })),
      recentFavorites,
      recentCollections: recentCollections.map((c) => ({
        id: c.id, name: c.name, color: c.color, itemCount: c._count.items,
      })),
    });
  } catch (error: unknown) {
    console.error('[Dashboard] API failed:', error);
    const message = error instanceof Error ? error.message : 'Dashboard query failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
