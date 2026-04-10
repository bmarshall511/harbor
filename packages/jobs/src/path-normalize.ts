/**
 * Path normalization for archive entries.
 *
 * Provider abstractions return paths in slightly different shapes:
 *   • Local FS:  `'Photos/2024/img.jpg'`        (relative, no leading slash)
 *   • Dropbox:   `'/My Archive/Photos'`    (absolute, leading slash, includes the root)
 *
 * Harbor stores file/folder rows keyed on `(archiveRootId, path)` —
 * meaning every storage layer must produce the same canonical path
 * shape or the unique constraint silently allows duplicates.
 *
 * The canonical shape we use is:
 *   • No leading slash
 *   • The archive-root portion stripped off
 *   • Empty string for the archive root itself
 *
 * Example, with `rootPath = '/My Archive'`:
 *   '/My Archive'              → ''
 *   '/My Archive/Photos'       → 'Photos'
 *   '/Private Archive/Photos/img.jpg' → 'Photos/img.jpg'
 *   'Photos/img.jpg'                → 'Photos/img.jpg'   (already canonical)
 *
 * This is the single helper that should be called before any file or
 * folder row gets persisted. Add new providers? Run their entry paths
 * through this function before upserting.
 */
export function toRelativePath(entryPath: string, rootPath: string | null | undefined): string {
  const stripped = (entryPath ?? '').replace(/^\/+/, '');
  const root = (rootPath ?? '').replace(/^\/+|\/+$/g, '');
  if (!root) return stripped;
  if (stripped === root) return '';
  if (stripped.startsWith(root + '/')) return stripped.slice(root.length + 1);
  return stripped;
}
