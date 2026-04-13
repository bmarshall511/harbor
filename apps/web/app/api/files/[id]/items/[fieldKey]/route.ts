import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive } from '@harbor/jobs';
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
 * Dedicated endpoint for mutating one entry of an array-typed metadata
 * field on a file. Replaces the delta-shape PATCH path so the client
 * cannot accidentally ship a "full new array" that wipes existing
 * values.
 *
 * The contract:
 *
 *   POST /api/files/:id/items/:fieldKey
 *     body: { op: 'add', value: 'tagName' }
 *     body: { op: 'add', value: { kind: 'free', name: 'Alice' } }
 *     body: { op: 'remove', value: 'tagName' }
 *     body: { op: 'remove', value: { kind: 'user', id: 'uuid', name: 'X' } }
 *     body: { op: 'clear' }
 *
 * Every operation runs under the per-file write lock and reads the
 * current sidecar BY UUID (`forceUuid: harborItemId`) so the merge
 * baseline is always whatever is actually on disk for this file —
 * never whatever the client cache happened to hold.
 *
 * Returns the freshly-mirrored file DTO so the client can drop the
 * response straight into its query cache.
 */

const ALLOWED_OPS = new Set(['add', 'remove', 'clear']);

const FIELD_PERM_MAP: Record<string, string> = {
  tags: 'items.tags',
  people: 'items.people',
  adult_content: 'items.adult_content',
};
function fieldPermission(fieldKey: string): string {
  return FIELD_PERM_MAP[fieldKey] ?? `items.custom.${fieldKey}`;
}

/**
 * Auto-detect the array's identity function from a sample element.
 * String arrays dedup case-insensitively; person-shaped objects dedup
 * by their canonical key (`u:<id>` or `f:<name>`).
 */
function keyOf(item: unknown): string {
  if (typeof item === 'string') return item.trim().toLowerCase();
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    if (o.kind === 'user' && typeof o.id === 'string') return `u:${o.id}`;
    if (typeof o.name === 'string') return `f:${o.name.trim().toLowerCase()}`;
  }
  return JSON.stringify(item);
}

function applyAdd(existing: unknown[], value: unknown): unknown[] {
  // Skip empty / blank string values — never useful in a tag list.
  if (typeof value === 'string' && value.trim().length === 0) return existing;
  const k = keyOf(value);
  if (existing.some((e) => keyOf(e) === k)) return existing;
  return [...existing, value];
}

function applyRemove(existing: unknown[], value: unknown): unknown[] {
  const k = keyOf(value);
  return existing.filter((e) => keyOf(e) !== k);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldKey: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'metadata', 'write');
  if (denied) return denied;

  const { id, fieldKey } = await params;

  // Field-level permission check.
  if (!permissionService.hasPermission(auth, fieldPermission(fieldKey), 'edit')) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: `No edit permission for ${fieldKey}` },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { op?: string; value?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: 'Body must be a JSON object' }, { status: 400 });
  }
  const op = body.op;
  if (!op || !ALLOWED_OPS.has(op)) {
    return NextResponse.json(
      { message: `op must be one of: ${[...ALLOWED_OPS].join(', ')}` },
      { status: 400 },
    );
  }
  if ((op === 'add' || op === 'remove') && body.value === undefined) {
    return NextResponse.json({ message: `op '${op}' requires a value` }, { status: 400 });
  }

  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  const metaRoot = metaRootForArchive(
    file.archiveRootId,
    root.rootPath,
    root.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
  );

  const item = await withFileWriteLock(id, async () => {
    // Read the live sidecar BY UUID so the baseline is exactly what
    // we'll write back. forceUuid below pins the write to the same
    // UUID and heals the path index.
    const existing = await archiveMeta.readItemByUuid(metaRoot, file.harborItemId);
    const currentArr =
      (existing?.fields?.[fieldKey] as unknown[] | undefined) ?? [];

    let nextArr: unknown[];
    if (op === 'clear') {
      nextArr = [];
    } else if (op === 'add') {
      nextArr = applyAdd(currentArr, body.value);
    } else {
      nextArr = applyRemove(currentArr, body.value);
    }

    const { item } = await archiveMeta.updateItem(
      metaRoot,
      file.path,
      {
        name: file.name,
        hash: file.hash ?? undefined,
        createdAt: file.fileCreatedAt,
        modifiedAt: file.fileModifiedAt,
      },
      { fields: { [fieldKey]: nextArr }, forceUuid: file.harborItemId },
    );

    // Mirror DB columns + tag-join table from the freshly-written JSON.
    await fileRepo.update(id, fileUpdatePayloadFromJson(item));
    await syncTagsForFile(id, item);

    return item;
  });

  // Fire-and-forget Dropbox sync — same pattern as PATCH.
  if (root.providerType === 'DROPBOX') {
    const itemJson = JSON.stringify(item, null, 2);
    syncMetadataToDropbox(file.archiveRootId, `items/${file.harborItemId}.json`, itemJson)
      .catch((err) => console.error('[ItemsRoute] Dropbox sidecar sync failed:', err));
    const index = await archiveMeta.readIndex(metaRoot);
    syncMetadataToDropbox(file.archiveRootId, 'index.json', JSON.stringify(index, null, 2))
      .catch((err) => console.error('[ItemsRoute] Dropbox index sync failed:', err));
  }

  // Ensure Person records exist for any added person.
  if (fieldKey === 'people' && op === 'add' && body.value && typeof body.value === 'object') {
    const v = body.value as { name?: string };
    if (typeof v.name === 'string' && v.name.trim().length > 0) {
      await ensurePersonRecord(v.name.trim()).catch((err) =>
        console.error('[People] Failed to ensure Person record:', err),
      );
    }
  }

  await audit(auth, 'update', 'FILE', id, null, { fieldKey, op, value: body.value });
  emit(
    'file.updated',
    { fileId: id, path: file.path, archiveRootId: file.archiveRootId },
    { archiveRootId: file.archiveRootId, userId: auth.userId },
  );
  emit(
    'metadata.updated',
    { entityType: 'FILE', entityId: id, fields: [fieldKey] },
    { userId: auth.userId },
  );

  const updated = await fileRepo.findById(id);
  if (!updated) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  return NextResponse.json(serializeFile(updated));
}

async function ensurePersonRecord(name: string) {
  const existing = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM persons WHERE lower(name) = lower($1) LIMIT 1`,
    name,
  );
  if (existing.length > 0) return;
  await db.person.create({ data: { name, isConfirmed: true } });
}
