/**
 * Per-fileId in-process write lock.
 *
 * The canonical metadata sidecar (`.harbor/items/{uuid}.json`) is
 * maintained via read-modify-write: read the file, merge a partial
 * update, write it back. If two requests for the same file race
 * through that cycle, the later write clobbers the earlier one and
 * individual field edits silently disappear.
 *
 * `withFileWriteLock` serialises all metadata writes for a given
 * file id within this process by chaining them onto a promise. It
 * keeps the critical section short and doesn't affect reads — only
 * mutations that need strict last-writer-wins semantics should use
 * it.
 *
 * Scope: single Node process. Multiple server instances writing the
 * same file would still need a distributed lock (e.g. Postgres
 * advisory locks). Harbor is currently single-instance so this is
 * the right layer.
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
