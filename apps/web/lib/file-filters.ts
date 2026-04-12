/**
 * File ignore-pattern filtering applied at query time.
 *
 * The indexer also honors `indexing.ignorePatterns`, but that only
 * prevents *new* files from being indexed. Files already in the DB
 * (e.g. indexed before the user added a pattern) need to be filtered
 * server-side at read time so the user immediately sees their
 * configured patterns take effect across the existing library —
 * without having to delete + re-index.
 *
 * Matching is the same as the indexer:
 *   • case-insensitive
 *   • exact name OR `*.ext` OR `prefix*` glob
 *   • trailing carriage return on the candidate filename is stripped
 *     so macOS resource-fork files like `Icon\r` match `Icon`
 */

import { getSetting } from '@/lib/settings';

export interface IgnoreMatcher {
  matches: (fileName: string) => boolean;
  isEmpty: boolean;
}

let cached: { value: string; matcher: IgnoreMatcher } | null = null;

/**
 * Build (or reuse a cached) matcher from the current
 * `indexing.ignorePatterns` setting. The cache is invalidated when the
 * raw setting string changes, so admins can edit the list and see the
 * effect on the very next request without a server restart.
 */
export async function getIgnoreMatcher(): Promise<IgnoreMatcher> {
  const raw = await getSetting('indexing.ignorePatterns');
  if (cached && cached.value === raw) return cached.matcher;

  const patterns = raw
    .split(',')
    .map((p: string) => p.trim().toLowerCase())
    .filter(Boolean);

  const matcher: IgnoreMatcher = {
    isEmpty: patterns.length === 0,
    matches(fileName: string) {
      if (patterns.length === 0) return false;
      const lower = fileName.replace(/\r$/, '').trim().toLowerCase();
      for (const pattern of patterns) {
        if (pattern === lower) return true;
        if (pattern.startsWith('*') && lower.endsWith(pattern.slice(1))) return true;
        if (pattern.endsWith('*') && lower.startsWith(pattern.slice(0, -1))) return true;
      }
      return false;
    },
  };

  cached = { value: raw, matcher };
  return matcher;
}

/**
 * Apply the current ignore matcher to a list of files.
 * Returns the filtered list (or the original list when no patterns
 * are configured, to avoid an unnecessary copy).
 */
export async function applyIgnoreFilter<T extends { name: string; path?: string }>(files: T[]): Promise<T[]> {
  const matcher = await getIgnoreMatcher();
  return files.filter((f) => {
    // Always exclude Harbor internal metadata files
    if (f.path && (f.path.startsWith('.harbor/') || f.path.includes('/.harbor/'))) return false;
    if (!matcher.isEmpty && matcher.matches(f.name)) return false;
    return true;
  });
}
