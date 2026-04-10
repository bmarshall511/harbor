import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository } from '@harbor/database';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'files', 'write');
  if (denied) return denied;

  const { id } = await params;
  const { targetFolderId } = await request.json();

  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root || !permissionService.canPerformFileOperation(auth, 'MOVE', root.capabilities)) {
    return NextResponse.json({ message: 'Move not permitted on this archive root' }, { status: 403 });
  }

  const oldFolderId = file.folderId;
  const updated = await fileRepo.update(id, { folder: targetFolderId ? { connect: { id: targetFolderId } } : { disconnect: true } });

  await audit(auth, 'move', 'FILE', id, { folderId: oldFolderId }, { folderId: targetFolderId });
  emit('file.moved', { fileId: id, path: file.path, archiveRootId: file.archiveRootId, folderId: targetFolderId }, { archiveRootId: file.archiveRootId, userId: auth.userId });

  return NextResponse.json(updated);
}
