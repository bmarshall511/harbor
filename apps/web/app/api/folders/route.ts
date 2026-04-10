import { NextResponse } from 'next/server';
import { FolderRepository, ArchiveRootRepository } from '@harbor/database';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const folderRepo = new FolderRepository();
const rootRepo = new ArchiveRootRepository();

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'files', 'write');
  if (denied) return denied;

  try {
    const { archiveRootId, parentId, name } = await request.json();
    if (!archiveRootId || !name) {
      return NextResponse.json({ message: 'archiveRootId and name are required' }, { status: 400 });
    }

    const root = await rootRepo.findById(archiveRootId);
    if (!root || !permissionService.canPerformFileOperation(auth, 'CREATE_FOLDERS', root.capabilities)) {
      return NextResponse.json({ message: 'Create folders not permitted on this archive root' }, { status: 403 });
    }

    // Compute path
    let path = name;
    if (parentId) {
      const parent = await folderRepo.findById(parentId);
      if (parent) {
        path = `${parent.path}/${name}`;
      }
    }

    const depth = path.split('/').length - 1;

    const folder = await folderRepo.create({
      archiveRoot: { connect: { id: archiveRootId } },
      name,
      path,
      depth,
      ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
    });

    await audit(auth, 'create', 'FOLDER', folder.id, null, { name, path });
    emit('folder.created', { folderId: folder.id, path, archiveRootId }, { archiveRootId, userId: auth.userId });

    return NextResponse.json(folder, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create folder';
    return NextResponse.json({ message }, { status: 500 });
  }
}
