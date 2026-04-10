/**
 * Provider path helpers.
 *
 * Harbor stores `File.path` in a canonical **root-relative** form
 * (no leading slash, archive-root prefix stripped). That keeps the
 * DB clean and makes paths directly useful for local-filesystem
 * reads where we `path.resolve(root.rootPath, file.path)`.
 *
 * But remote providers speak *their own* path dialects:
 *
 *   • Dropbox expects an absolute path from the connected account
 *     root, e.g. `/Private Archive/Photos/img.jpg`.
 *
 * To send a canonical path back out to a remote provider we need
 * to rebuild the full form by prepending the archive root's
 * `rootPath`. This file is the single place we do that.
 */

/**
 * Rebuild the full provider-native path for a file, given its
 * canonical relative path and the archive root it lives under.
 *
 * Local filesystem returns the relative path unchanged — callers
 * resolve it against `root.rootPath` with `path.resolve` when they
 * actually need an absolute disk path.
 *
 * Dropbox returns an absolute path. The function handles two DB
 * states that coexist in real deployments:
 *
 *   1. **Root-relative** paths (current indexer behaviour):
 *      file.path = "Photos/img.jpg", rootPath = "/My Archive"
 *      → "/My Archive/Photos/img.jpg"
 *
 *   2. **Already-absolute** paths (legacy, indexed before the
 *      `toRelativePath` normalization was added):
 *      file.path = "/Team Root/Photos/file.mp4",
 *      rootPath = "/Team Root"
 *      → "/Team Root/Photos/file.mp4" (no double prefix)
 *
 * Detection: if the stripped file.path already starts with the
 * stripped rootPath, we treat it as already-absolute and return it
 * with a leading `/` — no prepending.
 */
export function toProviderPath(
  relativePath: string,
  root: { providerType: string; rootPath: string },
): string {
  if (root.providerType !== 'DROPBOX') {
    return relativePath;
  }

  const prefix = (root.rootPath ?? '').replace(/^\/+|\/+$/g, '');
  const rel = (relativePath ?? '').replace(/^\/+|\/+$/g, '');

  // Already-absolute path (legacy): the file path starts with the
  // rootPath prefix, meaning it was stored before the indexer's
  // `toRelativePath` normalization was added. The rootPath is
  // already baked into the stored path — return it as-is with a
  // leading `/` so Dropbox sees the full absolute path.
  //
  // Example:
  //   rootPath = "/Team Root", file.path = "/Team Root/Photos/file.mp4"
  //   → "/Team Root/Photos/file.mp4" (rootPath already present)
  if (prefix && rel.startsWith(prefix + '/')) {
    return `/${rel}`;
  }
  if (prefix && rel === prefix) {
    return `/${rel}`;
  }

  // Root-relative path (current indexer behaviour): prepend rootPath.
  //
  // Example:
  //   rootPath = "/My Archive", file.path = "01_Photos/img.jpg"
  //   → "/My Archive/01_Photos/img.jpg"
  if (!prefix) return `/${rel}`;
  if (!rel) return `/${prefix}`;
  return `/${prefix}/${rel}`;
}
