import { db } from '@harbor/database';
import type { HarborItemJson } from '@harbor/providers';

/**
 * Single helper that turns a `HarborItemJson` (the canonical on-disk
 * shape) into the right DB-row update payload. Used by:
 *
 *   • The indexer (full reindex)
 *   • The file watcher (live reads on disk change)
 *   • The PATCH route (user metadata edits)
 *
 * Centralizing this means there is exactly one place that decides
 * which columns mirror the JSON, and a future schema column change
 * touches one file. Tags are handled separately because they live
 * in their own join table — see `syncTagsForFile`.
 *
 * **Critical safety**: the returned `meta` key REPLACES the entire
 * JSONB column when Prisma applies the update — there is no merge
 * semantic on Postgres JSONB. So if `item.core` and `item.fields`
 * are both empty (as they are when an indexer/file-watcher creates
 * a brand-new sidecar, or when a sidecar was just read fresh after
 * the user's edits never made it onto disk), writing this payload
 * would silently wipe every tag, person, and custom field the user
 * had previously added via the PATCH route. Callers in those code
 * paths read the sidecar AS the source of truth, so an empty
 * sidecar would override DB metadata that's actually correct.
 *
 * To prevent that catastrophic data loss, we omit `meta` from the
 * payload when both `core` and `fields` are empty. The PATCH route,
 * which writes the sidecar AND the DB in the same lock-held step,
 * always has non-empty fields by construction (the user's edit is
 * already merged in by that point), so it still rewrites `meta`
 * correctly.
 *
 * The same applies to `title`, `description`, and `rating` — they
 * default to `null` only if the sidecar HAS a `core` object. If
 * the sidecar's core is missing entirely, we don't touch those
 * columns either.
 */
export function fileUpdatePayloadFromJson(item: HarborItemJson) {
  const core = item.core ?? {};
  const fields = item.fields ?? {};
  const override = item.system?.createdAtOverride;
  // When the user has set a date override, it takes precedence over
  // whatever the indexer just stat'd off disk. Callers spread this
  // payload *after* the raw stat values, so returning `fileCreatedAt`
  // here overrides them. When there's no override, we omit the key
  // entirely so the stat value continues to win.
  const overridePayload =
    typeof override === 'string' && override.length > 0
      ? { fileCreatedAt: new Date(override) }
      : {};

  const hasCore = Object.keys(core).length > 0;
  const hasFields = Object.keys(fields).length > 0;

  // Empty sidecar → don't touch the meta-bearing DB columns. Leaves
  // the existing DB values alone so an empty-sidecar read can't wipe
  // user data.
  if (!hasCore && !hasFields) {
    return overridePayload;
  }

  return {
    title: core.title ?? null,
    description: core.description ?? null,
    rating: core.rating ?? null,
    ...overridePayload,
    // Mirror the entire JSON into the JsonB column for search.
    // We strip the per-file `system.path/name` so that searching the
    // metadata column doesn't accidentally hit the filesystem path.
    meta: stripSystemFromJson(item) as object,
  };
}

function stripSystemFromJson(item: HarborItemJson) {
  return {
    core: item.core ?? {},
    fields: item.fields ?? {},
    system: {
      hash: item.system?.hash,
      createdAt: item.system?.createdAt,
      modifiedAt: item.system?.modifiedAt,
      importedAt: item.system?.importedAt,
      updatedAt: item.system?.updatedAt,
      createdAtOverride: item.system?.createdAtOverride,
    },
  };
}

/**
 * Replace the tag set on a file with whatever the JSON file declares.
 * Tags listed under `fields.tags` (string array) are the source of
 * truth — anything previously attached but not in the JSON is removed.
 *
 * **Important distinction**:
 *
 *   • `fields.tags` is `[]`        → user explicitly cleared every
 *                                     tag; remove all FileTag rows.
 *   • `fields.tags` is missing      → caller didn't touch tags this
 *                                     time (e.g. an indexer reading
 *                                     a sidecar that has no tag
 *                                     data); LEAVE the FileTag rows
 *                                     alone. Returning early here is
 *                                     what stops the file watcher /
 *                                     reindexer from wiping a user's
 *                                     tags whenever they happen to
 *                                     run on a file whose sidecar
 *                                     has empty fields.
 */
export async function syncTagsForFile(fileId: string, item: HarborItemJson): Promise<void> {
  const raw = item.fields?.tags;
  if (raw === undefined) return;
  if (!Array.isArray(raw)) return;
  if (raw.length === 0) {
    // User explicitly cleared all tags.
    await db.fileTag.deleteMany({ where: { fileId } });
    return;
  }
  const tagNames = raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

  // Resolve / create each tag.
  const resolved = await Promise.all(
    tagNames.map((name) =>
      db.tag.upsert({
        where: { name },
        create: { name },
        update: {},
      }),
    ),
  );
  const wantedIds = new Set(resolved.map((t) => t.id));

  // Drop any FileTag rows whose tag isn't in the new set.
  await db.fileTag.deleteMany({
    where: { fileId, NOT: { tagId: { in: [...wantedIds] } } },
  });

  // Upsert the new join rows.
  for (const tag of resolved) {
    await db.fileTag.upsert({
      where: { fileId_tagId: { fileId, tagId: tag.id } },
      create: { fileId, tagId: tag.id, source: 'archive' },
      update: { source: 'archive' },
    });
  }
}
