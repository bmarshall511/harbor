import { NextResponse } from 'next/server';
import { FolderRepository, ArchiveRootRepository, TagRepository } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const repo = new FolderRepository();
const rootRepo = new ArchiveRootRepository();
const tagRepo = new TagRepository();
const archiveMeta = new ArchiveMetadataService();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const folder = await repo.findById(id);
  if (!folder) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: folder.id,
    archiveRootId: folder.archiveRootId,
    parentId: folder.parentId,
    name: folder.name,
    path: folder.path,
    depth: folder.depth,
    description: folder.description,
    eventDate: folder.eventDate?.toISOString() ?? null,
    location: folder.location,
    coverFileId: folder.coverFileId,
    tags: folder.tags.map((t) => ({
      id: t.tag.id,
      name: t.tag.name,
      color: t.tag.color,
      category: t.tag.category,
      usageCount: t.tag.usageCount,
    })),
    childCount: folder._count.children,
    fileCount: folder._count.files,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'metadata', 'write');
  if (denied) return denied;

  const { id } = await params;
  const before = await repo.findById(id);
  if (!before) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const body = await request.json();

  // Write to archive JSON (source of truth) — both local and remote
  // archives go through the same metadata service.
  const root = await rootRepo.findById(before.archiveRootId);
  if (root) {
    const { metaRootForArchive } = await import('@harbor/jobs');
    const metaRoot = metaRootForArchive(
      before.archiveRootId,
      root.rootPath,
      root.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
    );
    await archiveMeta.updateFolderMeta(metaRoot, before.path, {
      description: body.description,
      eventDate: body.eventDate,
      location: body.location,
      coverItemId: body.coverFileId,
      ...(body.tags ? { tags: body.tags } : {}),
    });
  }

  // Sync to DB cache
  const updated = await repo.update(id, {
    description: body.description,
    eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
    location: body.location,
    coverFileId: body.coverFileId,
  });

  // Handle tag additions
  if (body.tags && Array.isArray(body.tags)) {
    for (const tagName of body.tags) {
      const tag = await tagRepo.findOrCreate(tagName);
      await tagRepo.addToFolder(id, tag.id);
    }
  }

  await audit(auth, 'update', 'FOLDER', id, { description: before.description, location: before.location, eventDate: before.eventDate }, { description: body.description, location: body.location, eventDate: body.eventDate });
  emit('folder.updated', { folderId: id, path: before.path, archiveRootId: before.archiveRootId }, { archiveRootId: before.archiveRootId, userId: auth.userId });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'files', 'delete');
  if (denied) return denied;

  const { id } = await params;
  const folder = await repo.findById(id);
  if (!folder) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  await repo.delete(id);
  await audit(auth, 'delete', 'FOLDER', id, { name: folder.name, path: folder.path });
  emit('folder.deleted', { folderId: id, path: folder.path, archiveRootId: folder.archiveRootId }, { archiveRootId: folder.archiveRootId, userId: auth.userId });

  return new NextResponse(null, { status: 204 });
}
