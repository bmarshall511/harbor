/**
 * Per-fileId in-process write lock.
 *
 * Harbor's canonical metadata sidecar (`.harbor/items/{uuid}.json`)
 * is maintained via read-modify-write: read the file, merge a partial
 * update, write it back. If two writers for the same file race
 * through that cycle, the later write clobbers the earlier one and
 * individual field edits silently disappear.
 *
 * `withFileWriteLock` serialises all metadata writes for a given
 * file id within this Node process by chaining them onto a promise.
 * Callers pass a short-running async function that performs the
 * entire read-modify-write — it will wait its turn, run, and release.
 *
 * Notes:
 *
 *   • Scope: single Node process. Multiple web instances / background
 *     workers that share the same sidecar directory would need a
 *     distributed lock (e.g. Postgres advisory locks) on top. Harbor
 *     runs the web server and background jobs in the same process
 *     today, so a shared in-memory Map is the right level.
 *
 *   • Because this module is imported from `@harbor/utils`, every
 *     workspace package (apps/web routes AND packages/jobs) shares
 *     the same `locks` Map — that's the whole point. Do NOT
 *     reinstantiate the map per-caller.
 *
 *   • This lock only protects writes. Reads are unaffected and may
 *     return an in-progress state if they happen mid-write; that's
 *     fine for Harbor's UI because react-query will refetch after
 *     the mutation settles.
 */

const locks = new Map<string, Promise<unknown>>();

export async function withFileWriteLock<T>(
  fileId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(fileId) ?? Promise.resolve();
  // Swallow the previous error so one failing writer doesn't poison
  // the chain — the next caller still runs on a clean baseline.
  const next = prev.catch(() => undefined).then(fn);
  locks.set(fileId, next);
  try {
    return await next;
  } finally {
    // Only clear the slot if nobody else queued behind us. If
    // another caller chained onto `next` after we set it, their
    // promise is now the newest and we must not erase it.
    if (locks.get(fileId) === next) locks.delete(fileId);
  }
}
