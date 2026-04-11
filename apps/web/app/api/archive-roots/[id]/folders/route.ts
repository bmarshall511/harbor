import { NextResponse } from 'next/server';
import { FolderRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const repo = new FolderRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
  const { id } = await params;
  const folders = await repo.findRootFolders(id);
  return NextResponse.json(
    folders.map((f) => ({
      id: f.id,
      archiveRootId: f.archiveRootId,
      parentId: f.parentId,
      name: f.name,
      path: f.path,
      depth: f.depth,
      description: f.description,
      eventDate: f.eventDate?.toISOString() ?? null,
      location: f.location,
      coverFileId: f.coverFileId,
      tags: f.tags.map((t) => ({
        id: t.tag.id,
        name: t.tag.name,
        color: t.tag.color,
        category: t.tag.category,
        usageCount: t.tag.usageCount,
      })),
      childCount: f._count.children,
      fileCount: f._count.files,
    })),
  );
  } catch (error: unknown) {
    console.error('[Folders] Root folders query failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to load folders';
    return NextResponse.json({ message }, { status: 500 });
  }
}
