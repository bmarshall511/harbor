import { NextResponse } from 'next/server';
import { FileRepository, TagRepository, ArchiveRootRepository, db } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { serializeFile } from '@/lib/file-dto';

const fileRepo = new FileRepository();
const tagRepo = new TagRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

function providerTypeForRoot(providerType: string): string {
  return providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote';
}

/**
 * GET /api/files/batch?ids=id1,id2,id3
 * Fetches multiple files by id in a single round trip. Used by the
 * Recently Viewed dashboard section to look up files the user has
 * actually opened (which may live anywhere in the library, not just
 * in the dashboard's "recently indexed" set).
 *
 * Returns an array preserving the requested order, with missing or
 * deleted files silently filtered out. Capped at 100 ids per call.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const idsParam = url.searchParams.get('ids') ?? '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (ids.length === 0) return NextResponse.json([]);

  const rows = await db.file.findMany({
    where: { id: { in: ids }, status: { notIn: ['DELETED', 'PENDING_DELETE'] } },
    include: {
      tags: { include: { tag: true } },
      previews: { where: { size: 'THUMBNAIL' } },
    },
  });

  // Preserve the input order so "Recently Viewed" stays in MRU order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof rows;

  return NextResponse.json(ordered.map((f) => serializeFile(f)));
}

/**
 * POST /api/files/batch — Perform batch operations on multiple files.
 * Body: { action: 'move' | 'delete' | 'addTags', fileIds: string[], ... }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { action, fileIds } = body;

  if (!action || !Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ message: 'action and fileIds[] are required' }, { status: 400 });
  }

  if (fileIds.length > 500) {
    return NextResponse.json({ message: 'Maximum 500 files per batch' }, { status: 400 });
  }

  const results = { success: 0, failed: 0, errors: [] as string[] };

  if (action === 'delete') {
    // "delete" in batch context now means "mark for delete" — the
    // bytes don't go anywhere until an admin approves the queue
    // entry. Same contract as the per-file delete-request endpoint.
    const denied = requirePermission(auth, 'files', 'delete');
    if (denied) return denied;

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

    for (const fileId of fileIds) {
      try {
        const file = await fileRepo.findById(fileId);
        if (!file) { results.failed++; continue; }
        if (file.status === 'PENDING_DELETE' || file.status === 'DELETED') {
          // Already in the queue or already gone — count as success
          // so the batch op is idempotent for the user.
          results.success++;
          continue;
        }

        await db.deleteRequest.create({
          data: {
            fileId: file.id,
            archiveRootId: file.archiveRootId,
            fileName: file.name,
            filePath: file.path,
            fileSize: file.size,
            fileMimeType: file.mimeType,
            reason: reason || null,
            requestedByUserId: auth.userId,
          },
        });
        await fileRepo.markForDelete(file.id);

        await audit(auth, 'mark-for-delete', 'FILE', fileId, { name: file.name }, { reason });
        emit('file.updated', { fileId, archiveRootId: file.archiveRootId, path: file.path }, { userId: auth.userId });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${fileId}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  } else if (action === 'move') {
    const denied = requirePermission(auth, 'files', 'write');
    if (denied) return denied;

    const { targetFolderId } = body;
    if (!targetFolderId) {
      return NextResponse.json({ message: 'targetFolderId required for move' }, { status: 400 });
    }

    for (const fileId of fileIds) {
      try {
        const file = await fileRepo.findById(fileId);
        if (!file) { results.failed++; continue; }
        await fileRepo.update(fileId, { folder: { connect: { id: targetFolderId } } });
        await audit(auth, 'move', 'FILE', fileId, { folderId: file.folderId }, { folderId: targetFolderId });
        emit('file.moved', { fileId, archiveRootId: file.archiveRootId, folderId: targetFolderId }, { userId: auth.userId });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${fileId}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  } else if (action === 'addTags') {
    const denied = requirePermission(auth, 'tags', 'write');
    if (denied) return denied;

    const { tags } = body;
    if (!Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ message: 'tags[] required for addTags' }, { status: 400 });
    }

    // Resolve tag IDs
    const resolvedTags = [];
    for (const tagName of tags) {
      const tag = await tagRepo.findOrCreate(tagName);
      resolvedTags.push(tag);
    }

    for (const fileId of fileIds) {
      try {
        const file = await fileRepo.findById(fileId);
        if (!file) { results.failed++; continue; }
        const root = await rootRepo.findById(file.archiveRootId);
        if (!root) { results.failed++; continue; }

        // Write the merged tag list to the canonical JSON, then sync
        // both the DB row's `meta` mirror and the FileTag join table.
        const existingTagNames = file.tags.map((t) => t.tag.name);
        const merged = Array.from(new Set([...existingTagNames, ...resolvedTags.map((t) => t.name)]));

        const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
        const { item } = await archiveMeta.updateItem(
          metaRoot,
          file.path,
          { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
          { fields: { tags: merged } },
        );
        await fileRepo.update(fileId, fileUpdatePayloadFromJson(item));
        await syncTagsForFile(fileId, item);

        emit('tag.added', { entityType: 'FILE', entityId: fileId }, { userId: auth.userId });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${fileId}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  } else if (action === 'addPeople') {
    // Bulk-add People to a custom metadata field. Routes through the
    // canonical JSON service so the on-disk JSON stays the source of
    // truth and the DB row's `meta` mirror is automatically rebuilt.
    const denied = requirePermission(auth, 'metadata', 'write');
    if (denied) return denied;

    const { fieldKey, people } = body as {
      fieldKey?: string;
      people?: Array<{ kind: 'user' | 'free'; id?: string; name: string }>;
    };
    if (!fieldKey || !Array.isArray(people) || people.length === 0) {
      return NextResponse.json({ message: 'fieldKey and people[] required' }, { status: 400 });
    }

    function dedupeKey(p: { kind: 'user' | 'free'; id?: string; name: string }): string {
      return p.kind === 'user' && p.id ? `u:${p.id}` : `f:${p.name.trim().toLowerCase()}`;
    }

    for (const fileId of fileIds) {
      try {
        const file = await fileRepo.findById(fileId);
        if (!file) { results.failed++; continue; }
        const root = await rootRepo.findById(file.archiveRootId);
        if (!root) { results.failed++; continue; }

        const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
        const existing = await archiveMeta.readItem(metaRoot, file.path);
        const current = (existing?.fields?.[fieldKey] as Array<{ kind: 'user' | 'free'; id?: string; name: string }> | undefined) ?? [];

        const seen = new Set(current.map(dedupeKey));
        const merged = [...current];
        for (const p of people) {
          const k = dedupeKey(p);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(p);
        }

        const { item } = await archiveMeta.updateItem(
          metaRoot,
          file.path,
          { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
          { fields: { [fieldKey]: merged } },
        );
        await fileRepo.update(fileId, fileUpdatePayloadFromJson(item));

        emit('metadata.updated', { entityType: 'FILE', entityId: fileId, fields: [fieldKey] }, { userId: auth.userId });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${fileId}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  } else if (action === 'setMultiselect') {
    // Bulk-set the values of a multiselect custom metadata field
    // (e.g. "adult content"). Replaces existing values per file.
    const denied = requirePermission(auth, 'metadata', 'write');
    if (denied) return denied;

    const { fieldKey, values } = body as { fieldKey?: string; values?: string[] };
    if (!fieldKey || !Array.isArray(values)) {
      return NextResponse.json({ message: 'fieldKey and values[] required' }, { status: 400 });
    }

    for (const fileId of fileIds) {
      try {
        const file = await fileRepo.findById(fileId);
        if (!file) { results.failed++; continue; }
        const root = await rootRepo.findById(file.archiveRootId);
        if (!root) { results.failed++; continue; }
        const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));

        const { item } = await archiveMeta.updateItem(
          metaRoot,
          file.path,
          { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
          { fields: { [fieldKey]: values.length > 0 ? values : null } },
        );
        await fileRepo.update(fileId, fileUpdatePayloadFromJson(item));

        emit('metadata.updated', { entityType: 'FILE', entityId: fileId, fields: [fieldKey] }, { userId: auth.userId });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${fileId}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  } else {
    return NextResponse.json({ message: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(results);
}
