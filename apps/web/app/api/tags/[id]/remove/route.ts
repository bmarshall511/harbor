import { NextResponse } from 'next/server';
import { TagRepository, FileRepository, FolderRepository, ArchiveRootRepository } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive } from '@harbor/jobs';
import { withFileWriteLock } from '@harbor/utils';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const tagRepo = new TagRepository();
const fileRepo = new FileRepository();
const folderRepo = new FolderRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

function providerTypeForRoot(providerType: string): string {
  return providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'tags', 'write');
  if (denied) return denied;

  const { id: tagId } = await params;
  const { entityType, entityId } = await request.json();

  if (!entityType || !entityId) {
    return NextResponse.json({ message: 'entityType and entityId are required' }, { status: 400 });
  }

  try {
    if (entityType === 'FILE') {
      // Re-write the canonical JSON with the tag dropped, then let
      // the shared sync helpers update the FileTag join table and
      // the DB row's `meta` mirror.
      const file = await fileRepo.findById(entityId);
      if (file) {
        const root = await rootRepo.findById(file.archiveRootId);
        if (root) {
          const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
          // Lock the read-modify-write so a concurrent PATCH /
          // batch addTags on the same file can't put the removed
          // tag back.
          await withFileWriteLock(entityId, async () => {
            const remainingTags = file.tags
              .filter((t) => t.tag.id !== tagId)
              .map((t) => t.tag.name);
            const { item } = await archiveMeta.updateItem(
              metaRoot,
              file.path,
              { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
              { fields: { tags: remainingTags } },
            );
            await fileRepo.update(entityId, fileUpdatePayloadFromJson(item));
            await syncTagsForFile(entityId, item);
          });
        }
      }
    } else if (entityType === 'FOLDER') {
      await tagRepo.removeFromFolder(entityId, tagId);

      // Write-back the folder's tag list to .harbor/folders/.../meta.json.
      const folder = await folderRepo.findById(entityId);
      if (folder) {
        const root = await rootRepo.findById(folder.archiveRootId);
        if (root) {
          const remainingTags = folder.tags
            .filter((t) => t.tag.id !== tagId)
            .map((t) => t.tag.name);
          const metaRoot = metaRootForArchive(folder.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
          await archiveMeta.updateFolderMeta(metaRoot, folder.path, { tags: remainingTags });
        }
      }
    } else {
      return NextResponse.json({ message: 'Invalid entityType' }, { status: 400 });
    }

    await audit(auth, 'update', entityType, entityId, { removedTagId: tagId }, null);
    emit('tag.removed', { entityType, entityId, tagId }, { userId: auth.userId });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to remove tag';
    return NextResponse.json({ message }, { status: 500 });
  }
}
