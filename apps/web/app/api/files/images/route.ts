import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/files/images — Lightweight image file listing for the avatar picker.
 *
 * Query params:
 *   ?q=searchTerm  — filter by filename (optional)
 *   ?limit=50      — max results (default 50)
 *
 * Returns only image files (mimeType starts with 'image/') that are
 * indexed and have at least a thumbnail preview available.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100);

  try {
    const files = await db.file.findMany({
      where: {
        mimeType: { startsWith: 'image/' },
        status: 'INDEXED',
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        name: true,
        archiveRootId: true,
        previews: {
          where: { size: 'THUMBNAIL' },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { fileCreatedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(
      files.map((f) => ({
        id: f.id,
        name: f.name,
        archiveRootId: f.archiveRootId,
        thumbnailUrl: `/api/files/${f.id}/preview?size=THUMBNAIL`,
        hasPreview: f.previews.length > 0,
      })),
    );
  } catch (err) {
    console.error('[Files/Images] GET failed:', err);
    return NextResponse.json([], { status: 200 });
  }
}
