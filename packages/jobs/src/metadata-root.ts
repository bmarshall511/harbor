import * as path from 'node:path';

/**
 * Resolve the directory the `ArchiveMetadataService` should treat as
 * the metadata root for a given archive.
 *
 * The rule is provider-aware:
 *
 *   • LOCAL filesystem archives — the JSON files live INSIDE the
 *     archive itself, in `{archiveRootPath}/.harbor/`. This means
 *     metadata is portable: copy or move the archive directory and
 *     the metadata comes with it. Other tools can read the JSON
 *     directly from disk without involving Harbor.
 *
 *   • DROPBOX archives — Harbor doesn't write to the user's Dropbox
 *     account. Instead, JSON files live server-side under the
 *     Harbor data directory at:
 *       `{HARBOR_DATA_DIR}/harbor-meta/{archiveRootId}/.harbor/`
 *     The directory still uses the same `.harbor/` layout the local
 *     case uses, so the `ArchiveMetadataService` doesn't need to
 *     branch on provider type.
 *
 * The data dir is resolved from the `HARBOR_DATA_DIR` env var (with
 * a sensible default) so a single source of truth controls where
 * Harbor stores everything app-managed on disk.
 */
export function metaRootForArchive(
  archiveRootId: string,
  archiveRootPath: string,
  providerType: string,
): string {
  if (providerType === 'local') {
    return archiveRootPath;
  }
  // Dropbox + any future remote provider falls back to the
  // server-side metadata cache.
  const dataDir = process.env.HARBOR_DATA_DIR ?? './data';
  return path.resolve(dataDir, 'harbor-meta', archiveRootId);
}
