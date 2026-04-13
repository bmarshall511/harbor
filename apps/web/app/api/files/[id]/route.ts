import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive } from '@harbor/jobs';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { serializeFile } from '@/lib/file-dto';
import { syncMetadataToDropbox } from '@/lib/dropbox-metadata-sync';
import { withFileWriteLock } from '@/lib/file-write-lock';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

/**
 * Body keys that map directly to a top-level `core.*` field on the
 * canonical JSON. Anything else lands in `fields.*` (the open-ended
 * custom-metadata bucket: People, Adult Content, EXIF, AI fields,
 * any user-defined metadata field).
 *
 * `tags` is special-cased: it's a JSON `fields.tags: string[]` AND
 * it gets mirrored into the relational `FileTag` join table by the
 * shared `syncTagsForFile` helper.
 */
const CORE_FIELD_KEYS = new Set(['title', 'description', 'rating']);

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

  // Per-field permission checks: reject any fields the user can't edit
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

  // Split incoming body into the core/fields/tags partitions of the
  // canonical JSON. Tags are merged with what's already on the file
  // (existing tags + new ones); core/fields are upserted (set or clear).
  const core: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  let nextTags: string[] | null = null;
  for (const [key, value] of Object.entries(body)) {
    if (key === 'tags') {
      if (Array.isArray(value)) {
        nextTags = value.filter((t): t is string => typeof t === 'string');
      }
      continue;
    }
    if (CORE_FIELD_KEYS.has(key)) {
      core[key] = value;
    } else {
      fields[key] = value;
    }
  }

  if (nextTags) {
    // Existing tag names already on the file, merged with the
    // incoming list to preserve any tag the client did not echo back.
    const existingTagNames = before.tags.map((t) => t.tag.name);
    const merged = Array.from(new Set([...existingTagNames, ...nextTags]));
    fields.tags = merged;
  }

  // Step 1 — write the canonical JSON file + mirror it to the DB row.
  // The whole read-modify-write cycle is held under a per-file lock
  // so concurrent edits (e.g. the AI Apply path firing title /
  // description / tags in parallel) can't trample each other. Without
  // the lock, the last writer wins and individual fields silently
  // disappear. The lock is short — it only guards the sidecar + DB
  // sync, not the fire-and-forget Dropbox upload.
  const metaRoot = metaRootForArchive(before.archiveRootId, root.rootPath, providerTypeForRoot(root.providerType));
  const { item } = await withFileWriteLock(id, async () => {
    const { item } = await archiveMeta.updateItem(
      metaRoot,
      before.path,
      {
        name: before.name,
        hash: before.hash ?? undefined,
        createdAt: before.fileCreatedAt,
        modifiedAt: before.fileModifiedAt,
      },
      { core, fields },
    );

    // Step 2 — mirror the derived DB columns from the freshly-written
    // JSON. Kept inside the lock so a concurrent reader never sees
    // the JSON and the DB disagree.
    await fileRepo.update(id, fileUpdatePayloadFromJson(item));
    await syncTagsForFile(id, item);

    return { item };
  });

  // Step 1b — sync the metadata JSON to Dropbox so it's visible on
  // all devices and deployments. This runs fire-and-forget so it
  // doesn't block the response. The JSON written in step 1 is the
  // canonical content; this just uploads it to Dropbox.
  if (root.providerType === 'DROPBOX') {
    const itemJson = JSON.stringify(item, null, 2);
    syncMetadataToDropbox(before.archiveRootId, `items/${before.harborItemId}.json`, itemJson)
      .catch((err) => console.error('[MetaSync] Dropbox item sync failed:', err));

    // Also sync the index.json so other instances can find the UUID
    const index = await archiveMeta.readIndex(metaRoot);
    syncMetadataToDropbox(before.archiveRootId, 'index.json', JSON.stringify(index, null, 2))
      .catch((err) => console.error('[MetaSync] Dropbox index sync failed:', err));
  }

  // Step 2b — ensure Person records exist for every name in
  // meta.fields.people. This bridges the per-file JSON annotation
  // with the canonical Person registry so admins always see every
  // referenced person in the People management page, and the search
  // filter picker stays in sync.
  if (fields.people && Array.isArray(fields.people)) {
    await ensurePersonRecords(fields.people as Array<{ kind?: string; name?: string }>);
  }

  // Step 3 — audit + realtime fanout.
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
 * remove a file is now to mark it for delete (which moves it to
 * the admin delete queue) via `POST /api/files/:id/delete-request`,
 * and then have an admin approve the request from the admin
 * settings page. This is the contract the rest of the app
 * (detail panel, batch toolbar, viewer) is wired against — there
 * should be no path that hard-deletes user data without admin review.
 */

/** Map the schema's provider-type enum to the string `metaRootForArchive` expects. */
function providerTypeForRoot(providerType: string): string {
  return providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote';
}

/**
 * For every person name in the metadata array, ensure a Person row
 * exists in the DB. This is an upsert-by-name — if a Person with
 * that exact name (case-insensitive) already exists, we skip it.
 * New Person records are created as confirmed (since the user
 * explicitly typed the name, it's not an unverified face cluster).
 *
 * This runs fire-and-forget — a failure here should not block the
 * metadata save.
 */
async function ensurePersonRecords(people: Array<{ kind?: string; name?: string }>) {
  try {
    for (const entry of people) {
      const name = entry?.name?.trim();
      if (!name) continue;

      // Case-insensitive check: Prisma doesn't support `mode: insensitive`
      // on findFirst with a non-unique field, so we use raw SQL.
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
    // Non-fatal — log but don't fail the request
    console.error('[People] Failed to ensure Person records:', err);
  }
}
