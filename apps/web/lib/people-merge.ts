/**
 * People-field merge utilities.
 *
 * The "People" metadata field stores a JSON array of `Person` entries:
 *
 *   { kind: 'user', id: '<userId>', name: '<display>' }
 *   { kind: 'free', name: '<typed-name>' }
 *
 * Free-text entries are added when a person has been tagged on a file
 * but is not (yet) a registered user — e.g. "Aunt Linda". When a user
 * is later created whose display name matches a remembered free-text
 * entry, those entries should be **upgraded in place** so the file's
 * People field links to the real user account.
 *
 * This module is the single source of truth for that merge logic.
 */

import { db } from '@harbor/database';
import { withFileWriteLock } from '@harbor/utils';

export type Person =
  | { kind: 'user'; id: string; name: string }
  | { kind: 'free'; name: string };

/** Normalize for fuzzy matching: trim, collapse whitespace, lower-case. */
function normalize(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Pure: given a list of People and a freshly-promoted user, return
 * the new list with any matching free-text entries replaced by a
 * `user` entry pointing at the real user. Order is preserved.
 *
 * Matching candidates: the user's `displayName`, `username`, plus any
 * additional aliases the caller passes in. All comparisons are
 * case-insensitive and whitespace-tolerant.
 */
export function mergePeopleWithUser(
  people: Person[],
  user: { id: string; displayName: string; username: string },
  extraAliases: string[] = [],
): { people: Person[]; changed: boolean } {
  const candidates = new Set(
    [user.displayName, user.username, ...extraAliases]
      .filter(Boolean)
      .map(normalize),
  );

  let changed = false;
  const next: Person[] = [];

  for (const entry of people) {
    if (entry.kind === 'free' && candidates.has(normalize(entry.name))) {
      next.push({ kind: 'user', id: user.id, name: user.displayName });
      changed = true;
    } else {
      next.push(entry);
    }
  }

  // Dedupe: if a file already had this user AND a free-text version,
  // collapse to a single user entry (preserve first occurrence).
  const seen = new Set<string>();
  const deduped: Person[] = [];
  for (const p of next) {
    const k = p.kind === 'user' ? `u:${p.id}` : `f:${normalize(p.name)}`;
    if (seen.has(k)) {
      changed = true;
      continue;
    }
    seen.add(k);
    deduped.push(p);
  }

  return { people: deduped, changed };
}

/** Read a `Person[]` from a stored FileMetadata.value JSON string. */
export function parsePeopleValue(raw: string): Person[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Person[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        out.push({ kind: 'free', name: item.trim() });
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (obj.kind === 'user' && typeof obj.id === 'string' && typeof obj.name === 'string') {
          out.push({ kind: 'user', id: obj.id, name: obj.name });
        } else if (typeof obj.name === 'string') {
          out.push({ kind: 'free', name: obj.name });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Scan every file's `meta` JSON column for People-type fields and
 * rewrite any free-text entries that match the freshly-created user.
 * Writes the merged JSON back through the canonical metadata service
 * (so the on-disk JSON stays in sync) AND updates the DB row's
 * `meta` mirror.
 *
 * Returns the number of files modified.
 */
export async function mergeFreeTextIntoUser(user: {
  id: string;
  displayName: string;
  username: string;
}, extraAliases: string[] = []): Promise<number> {
  const { ArchiveMetadataService } = await import('@harbor/providers');
  const { fileUpdatePayloadFromJson, metaRootForArchive } = await import('@harbor/jobs');
  const archiveMeta = new ArchiveMetadataService();

  // Discover every "people"-typed field key registered in the
  // metadata templates.
  const peopleFields = await db.metadataFieldTemplate.findMany({
    where: { fieldType: 'people' },
    select: { key: true },
  });
  if (peopleFields.length === 0) return 0;
  const keys = peopleFields.map((f) => f.key);

  // Pull every file's `meta` and merge in JS. This routine only runs
  // when an admin creates a new user account, so a full scan is fine
  // — and it sidesteps the awkwardness of OR-ing multiple JSONB path
  // filters in Prisma.
  const candidateFiles = await db.file.findMany({
    include: { archiveRoot: true },
    take: 5000,
  });

  let modified = 0;
  for (const file of candidateFiles) {
    const meta = (file.meta as { fields?: Record<string, unknown> } | null) ?? null;
    if (!meta?.fields) continue;

    let changedAny = false;
    const updatedFields: Record<string, unknown> = {};
    for (const fieldKey of keys) {
      const value = meta.fields[fieldKey];
      if (!Array.isArray(value)) continue;
      const current = value as Person[];
      const { people, changed } = mergePeopleWithUser(current, user, extraAliases);
      if (changed) {
        updatedFields[fieldKey] = people;
        changedAny = true;
      }
    }
    if (!changedAny) continue;

    const metaRoot = metaRootForArchive(
      file.archiveRootId,
      file.archiveRoot.rootPath,
      file.archiveRoot.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
    );
    await withFileWriteLock(file.id, async () => {
      const { item } = await archiveMeta.updateItem(
        metaRoot,
        file.path,
        { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
        { fields: updatedFields, forceUuid: file.harborItemId },
      );
      await db.file.update({
        where: { id: file.id },
        data: fileUpdatePayloadFromJson(item),
      });
    });
    modified++;
  }

  return modified;
}
