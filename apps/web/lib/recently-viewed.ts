'use client';

/**
 * Recently-viewed tracker (DB-backed).
 *
 * The truth lives in the `recent_views` table on the server, so:
 *   • The history survives a browser-data clear.
 *   • It syncs automatically across the web app + Electron client.
 *   • It can be queried server-side (e.g. by the recommender) without
 *     a per-client round-trip.
 *
 * `trackView(fileId)` POSTs to `/api/recent-views` and broadcasts a
 * lightweight event so any open dashboard refreshes immediately.
 *
 * `useRecentViewedFiles()` is a React Query hook that returns the
 * resolved `FileDto[]` for the current user, newest first.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileDto } from '@harbor/types';

const CHANGE_EVENT = 'harbor:recently-viewed-changed';

export async function trackView(fileId: string): Promise<void> {
  try {
    await fetch('/api/recent-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  } catch {
    /* non-fatal */
  }
}

export async function clearRecentlyViewed(): Promise<void> {
  await fetch('/api/recent-views', { method: 'DELETE' });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

/**
 * React hook that returns the current user's recently-viewed files,
 * newest first. Limit defaults to 18 so it pairs cleanly with the
 * dashboard's 9-column grid.
 */
export function useRecentlyViewedFiles(limit = 18): FileDto[] {
  const qc = useQueryClient();
  const { data = [] } = useQuery<FileDto[]>({
    queryKey: ['recently-viewed', limit],
    queryFn: async () => {
      const res = await fetch(`/api/recent-views?limit=${limit}`);
      if (!res.ok) return [] as FileDto[];
      return (await res.json()) as FileDto[];
    },
    staleTime: 30_000,
  });

  // Refetch on the in-page custom event so freshly-tracked views show
  // up without waiting for the staleTime.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = () => {
      qc.invalidateQueries({ queryKey: ['recently-viewed'] });
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [qc]);

  return data;
}
