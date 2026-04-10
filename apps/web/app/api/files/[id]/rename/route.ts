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
  const { newName } = await request.json();
  if (!newName) return NextResponse.json({ message: 'newName is required' }, { status: 400 });

  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root || !permissionService.canPerformFileOperation(auth, 'RENAME', root.capabilities)) {
    return NextResponse.json({ message: 'Rename not permitted on this archive root' }, { status: 403 });
  }

  const oldName = file.name;
  const updated = await fileRepo.update(id, { name: newName });

  await audit(auth, 'rename', 'FILE', id, { name: oldName }, { name: newName });
  emit('file.updated', { fileId: id, path: file.path, archiveRootId: file.archiveRootId }, { archiveRootId: file.archiveRootId, userId: auth.userId });

  return NextResponse.json(updated);
}
