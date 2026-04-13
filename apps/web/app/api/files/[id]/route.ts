import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive } from '@harbor/jobs';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { serializeFile } from '@/lib/file-dto';
import { withFileWriteLock } from '@harbor/utils';
import { syncMetadataToDropbox } from '@/lib/dropbox-metadata-sync';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

/**
 * Body keys that map directly to a top-level `core.*` field on the
 * canonical JSON. Anything else lands in `fields.*` (the open-ended
 * custom-metadata bucket: People, Adult Content, EXIF, AI fields,
 * any user-defined metadata field).
 */
const CORE_FIELD_KEYS = new Set(['title', 'description', 'rating']);

/**
 * Field-update operations a client can send instead of a full array
 * replacement. The server resolves them against the file's *current*
 * sidecar value at lock-acquire time, so the merge baseline is always
 * the latest server state — never whatever the client happened to
 * have cached. This eliminates the "fields silently disappear when I
 * edit something else" class of bugs caused by clients submitting
 * full arrays built on top of stale cached data.
 *
 * Shapes accepted on any array-typed field (`tags`, `adult_content`,
 * `people`, etc.):
 *
 *   • Plain array     — full replacement (legacy callers)
 *   • `null`          — clear the field
 *   • `{ add: X }`    — add a single value (or array of values)
 *   • `{ remove: X }` — remove a single value (or array of values)
 *   • `{ set: [...] }`— explicit replacement (same as plain array)
 *   • `{ clear: true }` — explicit clear
 *
 * `add` and `remove` may be combined in the same op: `{ add: ['X'],
 * remove: ['Y'] }`.
 */
type FieldDelta = {
  add?: unknown;
  remove?: unknown;
  set?: unknown;
  clear?: boolean;
};

function isFieldDelta(value: unknown): value is FieldDelta {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return 'add' in obj || 'remove' in obj || 'set' in obj || 'clear' in obj;
}

/**
 * Pick the dedup/identity function for an array's element shape.
 * Strings dedup case-insensitively. People objects dedup by their
 * canonical key (`u:<id>` for registered users, `f:<name>` for
 * free-text). Anything else falls back to JSON identity.
 */
function detectKeyFn(sample: unknown): (item: unknown) => string {
  if (typeof sample === 'string') {
    return (item) => String(item ?? '').trim().toLowerCase();
  }
  if (sample && typeof sample === 'object') {
    const obj = sample as Record<string, unknown>;
    if ('kind' in obj || 'name' in obj) {
      return (item) => {
        const o = (item ?? {}) as Record<string, unknown>;
        if (o.kind === 'user' && typeof o.id === 'string') return `u:${o.id}`;
        const name = typeof o.name === 'string' ? o.name : '';
        return `f:${name.trim().toLowerCase()}`;
      };
    }
  }
  return (item) => JSON.stringify(item);
}

/**
 * Resolve a delta op against the existing array under the lock. The
 * caller is responsible for reading `existing` from the source of
 * truth (the on-disk JSON sidecar) before calling this, so that
 * concurrent writes serialise cleanly through the per-file lock.
 */
function applyFieldDelta(existing: unknown[], op: FieldDelta): unknown[] {
  if (op.clear) return [];
  if (op.set !== undefined) {
    return Array.isArray(op.set) ? op.set.slice() : [];
  }

  // Establish a key function from whatever's in the array, falling
  // back to whatever's in the add/remove payloads if the existing
  // array is empty.
  const sample =
    existing[0] ??
    (Array.isArray(op.add) ? op.add[0] : op.add) ??
    (Array.isArray(op.remove) ? op.remove[0] : op.remove);
  const keyFn = detectKeyFn(sample);

  let result = existing.slice();

  if (op.remove !== undefined) {
    const removeItems = Array.isArray(op.remove) ? op.remove : [op.remove];
    const removeKeys = new Set(removeItems.map(keyFn));
    result = result.filter((item) => !removeKeys.has(keyFn(item)));
  }

  if (op.add !== undefined) {
    const addItems = Array.isArray(op.add) ? op.add : [op.add];
    const seen = new Set(result.map(keyFn));
    for (const item of addItems) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }

  return result;
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

  // Per-field permission checks: reject any fields the user can't edit.
  const FIELD_PERM_MAP: Record<string, string> = {
    title: 'items.title',
    description: 'items.description',
    tags: 'items.tags',
    rating: 'items.file_metadata',
    caption: 'items.file_metadata',
    altText: 'items.file_metadata',
    adult_content: 'items.adult_content',
    people: 'items.people',
  };
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

  // Partition into core / fields. Tags are NOT special-cased anymore
  // — they go through `fields` with the same delta-op semantics as
  // every other array-shaped custom field.
  const core: Record<string, unknown> = {};
  const fieldsRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (CORE_FIELD_KEYS.has(key)) {
      core[key] = value;
    } else {
      fieldsRaw[key] = value;
    }
  }

  // The whole read-modify-write cycle runs under a per-file lock so
  // any concurrent edit (autosave on a different field, AI Apply,
  // batch op, indexer EXIF pass) is fully serialised. Crucially, all
  // delta ops are resolved AFTER acquiring the lock so each op sees
  // the latest server state — never a stale client cache.
  const metaRoot = metaRootForArchive(before.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
  const debugLog = process.env.HARBOR_DEBUG_METADATA === '1';
  const { item, resolvedFields } = await withFileWriteLock(id, async () => {
    // Read the current sidecar BY UUID so the baseline matches the
    // exact JSON we'll write back. Reading by path could resolve to
    // a different sidecar if `index.json` and the DB row's
    // `harborItemId` ever drift apart (legacy files, missed
    // reindexes, etc.) — and that drift is what was causing
    // delta ops on `tags` to apply to an empty baseline, replacing
    // the file's existing tags with just whatever the user added.
    const existing = await archiveMeta.readItemByUuid(metaRoot, before.harborItemId);

    if (debugLog) {
      console.log('[PATCH/files/:id] ─────────────────────────────');
      console.log('  fileId       :', id);
      console.log('  harborItemId :', before.harborItemId);
      console.log('  metaRoot     :', metaRoot);
      console.log('  body         :', JSON.stringify(body));
      console.log('  existing.fields:', existing?.fields ? JSON.stringify(existing.fields) : '(null)');
    }

    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fieldsRaw)) {
      if (isFieldDelta(value)) {
        const currentArr = (existing?.fields?.[key] as unknown[] | undefined) ?? [];
        const result = applyFieldDelta(currentArr, value);
        if (debugLog) {
          console.log(`  delta[${key}]: baseline=${JSON.stringify(currentArr)} op=${JSON.stringify(value)} result=${JSON.stringify(result)}`);
        }
        fields[key] = result;
      } else if (value === null) {
        fields[key] = [];
      } else {
        // Plain replacement — array OR scalar (caption, altText, ...).
        fields[key] = value;
      }
    }

    const { item } = await archiveMeta.updateItem(
      metaRoot,
      before.path,
      {
        name: before.name,
        hash: before.hash ?? undefined,
        createdAt: before.fileCreatedAt,
        modifiedAt: before.fileModifiedAt,
      },
      // forceUuid pins the write to the same UUID we just read
      // from. updateItem also heals the index entry so subsequent
      // path-based reads agree.
      { core, fields, forceUuid: before.harborItemId },
    );

    if (debugLog) {
      console.log('  written.fields:', JSON.stringify(item.fields));
    }

    // Mirror the derived DB columns from the freshly-written JSON.
    // Kept inside the lock so a concurrent reader never sees the JSON
    // and the DB disagree.
    await fileRepo.update(id, fileUpdatePayloadFromJson(item));
    await syncTagsForFile(id, item);

    return { item, resolvedFields: fields };
  });

  // Sync the metadata JSON to Dropbox so it's visible on all devices
  // and deployments. Fire-and-forget so the response isn't blocked.
  if (root.providerType === 'DROPBOX') {
    const itemJson = JSON.stringify(item, null, 2);
    syncMetadataToDropbox(before.archiveRootId, `items/${before.harborItemId}.json`, itemJson)
      .catch((err) => console.error('[MetaSync] Dropbox item sync failed:', err));

    const index = await archiveMeta.readIndex(metaRoot);
    syncMetadataToDropbox(before.archiveRootId, 'index.json', JSON.stringify(index, null, 2))
      .catch((err) => console.error('[MetaSync] Dropbox index sync failed:', err));
  }

  // Ensure Person records exist for every name in `meta.fields.people`.
  // This bridges the per-file JSON annotation with the canonical
  // Person registry so admins always see every referenced person.
  if (resolvedFields.people && Array.isArray(resolvedFields.people)) {
    await ensurePersonRecords(resolvedFields.people as Array<{ kind?: string; name?: string }>);
  }

  // Audit + realtime fanout.
  const changedFieldKeys = [...Object.keys(core), ...Object.keys(resolvedFields)];
  await audit(
    auth,
    'update',
    'FILE',
    id,
    { title: before.title, description: before.description, rating: before.rating },
    { core, fields: resolvedFields },
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

function providerTypeForRoot(providerType: string): string {
  return providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote';
}

async function ensurePersonRecords(people: Array<{ kind?: string; name?: string }>) {
  try {
    for (const entry of people) {
      const name = entry?.name?.trim();
      if (!name) continue;

      const existing = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM persons WHERE lower(name) = lower($1) LIMIT 1`,
        name,
      );
      if (existing.length > 0) continue;

      await db.person.create({
        data: { name, isConfirmed: true },
      });
    }
  } catch (err) {
    console.error('[People] Failed to ensure Person records:', err);
  }
}
