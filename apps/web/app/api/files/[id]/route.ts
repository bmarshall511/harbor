import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, metaRootForArchive } from '@harbor/jobs';
import { withFileWriteLock } from '@harbor/utils';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { serializeFile } from '@/lib/file-dto';
import { syncMetadataToDropbox } from '@/lib/dropbox-metadata-sync';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

/**
 * Body keys that map directly to a top-level `core.*` field on the
 * canonical JSON. Anything else lands in `fields.*` (the open-ended
 * scalar custom-metadata bucket: caption, altText, description-style
 * fields, etc.).
 *
 * **Array-typed fields are NOT handled here.** Tags, people, and
 * adult_content are managed exclusively through their own dedicated
 * route at `POST /api/files/[id]/items/[fieldKey]`, which runs each
 * add/remove/clear under the per-file write lock with the correct
 * baseline. Routing array writes through PATCH was the source of a
 * persistent class of bugs where a stale client could ship a "full
 * new array" and silently wipe values it didn't know about. PATCH
 * now refuses any non-scalar value to make that misuse impossible.
 */
const CORE_FIELD_KEYS = new Set(['title', 'description', 'rating']);

const FIELD_PERM_MAP: Record<string, string> = {
  title: 'items.title',
  description: 'items.description',
  rating: 'items.file_metadata',
  caption: 'items.file_metadata',
  altText: 'items.file_metadata',
};

/**
 * Field keys this route refuses to handle, because they're managed
 * by the dedicated items endpoint. Any client still sending these
 * here gets a clear 400 instead of a silent data loss.
 */
const ARRAY_FIELDS_REJECTED = new Set(['tags', 'people', 'adult_content']);

function providerTypeForRoot(providerType: string): string {
  return providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote';
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  return NextResponse.json(serializeFile(file));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'metadata', 'write');
  if (denied) return denied;

  const { id } = await params;
  const before = await fileRepo.findById(id);
  if (!before) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(before.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  const body = (await request.json()) as Record<string, unknown>;

  // Reject any array-typed field that's now exclusively owned by the
  // dedicated items route. A clear error beats silent data loss.
  const rejected = Object.keys(body).filter((k) => ARRAY_FIELDS_REJECTED.has(k));
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        code: 'USE_ITEMS_ROUTE',
        message: `Field(s) ${rejected.join(', ')} must be edited via POST /api/files/${id}/items/{fieldKey} with {op,value}`,
      },
      { status: 400 },
    );
  }

  // Per-field permission checks (scalar fields only).
  const denied_fields: string[] = [];
  for (const key of Object.keys(body)) {
    const resource = FIELD_PERM_MAP[key] ?? `items.custom.${key}`;
    if (!permissionService.hasPermission(auth, resource, 'edit')) {
      denied_fields.push(key);
    }
  }
  if (denied_fields.length > 0) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: `No edit permission for: ${denied_fields.join(', ')}` },
      { status: 403 },
    );
  }

  // Partition into core / fields. Only scalars allowed.
  const core: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (CORE_FIELD_KEYS.has(key)) {
      core[key] = value;
    } else {
      // Reject objects / arrays in fields — only scalars belong here.
      if (value !== null && typeof value === 'object') {
        return NextResponse.json(
          {
            code: 'INVALID_FIELD_VALUE',
            message: `Field '${key}' must be a scalar (string, number, boolean, or null)`,
          },
          { status: 400 },
        );
      }
      fields[key] = value;
    }
  }

  const metaRoot = metaRootForArchive(before.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
  const item = await withFileWriteLock(id, async () => {
    const { item } = await archiveMeta.updateItem(
      metaRoot,
      before.path,
      {
        name: before.name,
        hash: before.hash ?? undefined,
        createdAt: before.fileCreatedAt,
        modifiedAt: before.fileModifiedAt,
      },
      // forceUuid pins the write to the same UUID we'd read from,
      // and updateItem heals the path index entry so subsequent
      // path-based reads agree.
      { core, fields, forceUuid: before.harborItemId },
    );

    // Mirror the derived DB columns from the freshly-written JSON.
    await fileRepo.update(id, fileUpdatePayloadFromJson(item));

    return item;
  });

  // Fire-and-forget Dropbox sidecar mirror.
  if (root.providerType === 'DROPBOX') {
    const itemJson = JSON.stringify(item, null, 2);
    syncMetadataToDropbox(before.archiveRootId, `items/${before.harborItemId}.json`, itemJson)
      .catch((err) => console.error('[MetaSync] Dropbox item sync failed:', err));

    const index = await archiveMeta.readIndex(metaRoot);
    syncMetadataToDropbox(before.archiveRootId, 'index.json', JSON.stringify(index, null, 2))
      .catch((err) => console.error('[MetaSync] Dropbox index sync failed:', err));
  }

  // Audit + realtime fanout.
  const changedFieldKeys = [...Object.keys(core), ...Object.keys(fields)];
  await audit(
    auth,
    'update',
    'FILE',
    id,
    { title: before.title, description: before.description, rating: before.rating },
    { core, fields },
  );
  emit(
    'file.updated',
    { fileId: id, path: before.path, archiveRootId: before.archiveRootId },
    { archiveRootId: before.archiveRootId, userId: auth.userId },
  );
  emit(
    'metadata.updated',
    { entityType: 'FILE', entityId: id, fields: changedFieldKeys },
    { userId: auth.userId },
  );

  const updated = await fileRepo.findById(id);
  if (!updated) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  return NextResponse.json(serializeFile(updated));
}

/**
 * `DELETE /api/files/:id` is intentionally gone. The only way to
 * remove a file is to mark it for delete via
 * `POST /api/files/:id/delete-request`.
 */
