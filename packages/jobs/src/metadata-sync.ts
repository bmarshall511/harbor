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
 */
export function fileUpdatePayloadFromJson(item: HarborItemJson) {
  const core = item.core ?? {};
  return {
    title: core.title ?? null,
    description: core.description ?? null,
    rating: core.rating ?? null,
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
    },
  };
}

/**
 * Replace the tag set on a file with whatever the JSON file declares.
 * Tags listed under `fields.tags` (string array) are the source of
 * truth — anything previously attached but not in the JSON is removed.
 *
 * No-op when `fields.tags` is missing or not an array.
 */
export async function syncTagsForFile(fileId: string, item: HarborItemJson): Promise<void> {
  const raw = item.fields?.tags;
  if (!Array.isArray(raw)) return;
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
