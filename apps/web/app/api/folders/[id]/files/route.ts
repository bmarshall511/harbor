import { NextResponse } from 'next/server';
import { FileRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { applyIgnoreFilter } from '@/lib/file-filters';
import { serializeFile } from '@/lib/file-dto';

const repo = new FileRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const rawFiles = await repo.findByFolderId(id);
    const files = await applyIgnoreFilter(rawFiles);
    return NextResponse.json(files.map((f) => serializeFile(f)));
  } catch (error: unknown) {
    console.error('[Files] Folder files query failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to load files';
    return NextResponse.json({ message }, { status: 500 });
  }
}
