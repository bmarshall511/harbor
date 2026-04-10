import { NextResponse } from 'next/server';
import { FolderRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const repo = new FolderRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const folders = await repo.findTree(id);
  return NextResponse.json(
    folders.map((f) => ({
      id: f.id,
      archiveRootId: f.archiveRootId,
      parentId: f.parentId,
      name: f.name,
      path: f.path,
      depth: f.depth,
      childCount: f._count.children,
      fileCount: f._count.files,
    })),
  );
}
