import { NextResponse } from 'next/server';
import { FolderRepository, ArchiveRootRepository, db } from '@harbor/database';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const folderRepo = new FolderRepository();
const rootRepo = new ArchiveRootRepository();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'files', 'write');
  if (denied) return denied;

  const { id } = await params;
  const { targetFolderId } = await request.json();

  const folder = await folderRepo.findById(id);
  if (!folder) return NextResponse.json({ message: 'Folder not found' }, { status: 404 });

  const root = await rootRepo.findById(folder.archiveRootId);
  if (!root || !permissionService.canPerformFileOperation(auth, 'MOVE', root.capabilities)) {
    return NextResponse.json({ message: 'Move not permitted on this archive root' }, { status: 403 });
  }

  // Block self-move
  if (id === targetFolderId) {
    return NextResponse.json({ message: 'Cannot move a folder into itself' }, { status: 400 });
  }

  // Block move into a descendant (would create a cycle)
  if (targetFolderId) {
    const target = await folderRepo.findById(targetFolderId);
    if (target && target.path.startsWith(folder.path + '/')) {
      return NextResponse.json({ message: 'Cannot move a folder into one of its subfolders' }, { status: 400 });
    }
  }

  // Block move to same parent (no-op)
  if (folder.parentId === targetFolderId) {
    return NextResponse.json({ message: 'Folder is already in this location' }, { status: 400 });
  }

  const oldParentId = folder.parentId;

  // Compute new path
  let newPath = folder.name;
  let newDepth = 0;
  if (targetFolderId) {
    const target = await folderRepo.findById(targetFolderId);
    if (target) {
      newPath = `${target.path}/${folder.name}`;
      newDepth = target.depth + 1;
    }
  }

  const updated = await folderRepo.update(id, {
    parent: targetFolderId ? { connect: { id: targetFolderId } } : { disconnect: true },
    path: newPath,
    depth: newDepth,
  });

  await audit(auth, 'move', 'FOLDER', id, { parentId: oldParentId }, { parentId: targetFolderId });
  emit('folder.updated', { folderId: id, path: newPath, archiveRootId: folder.archiveRootId }, { archiveRootId: folder.archiveRootId, userId: auth.userId });

  return NextResponse.json(updated);
}
