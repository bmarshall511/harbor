'use client';

/**
 * Recently-viewed strip — a compact horizontal row of items the user
 * has recently opened. Optionally filtered to a particular folder /
 * archive root scope so the per-directory view only shows files the
 * user has viewed *while in that directory* (or that live in it).
 *
 * Used by:
 *   • The archive browser (per-folder)
 *   • Could be reused on the dashboard via the same component
 *
 * Hidden when there's nothing to show, so it never wastes vertical
 * space.
 */

import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import type { FileDto } from '@harbor/types';
import { useAppStore } from '@/lib/store';
import { useRecentlyViewedFiles } from '@/lib/recently-viewed';
import { getPreviewUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { friendlyName, getMimeCategory } from '@harbor/utils';

interface RecentlyViewedStripProps {
  /** When set, only files in this folder are shown. */
  folderId?: string;
  /** When set, only files in this archive root are shown. */
  archiveRootId?: string;
  limit?: number;
}

export function RecentlyViewedStrip({
  folderId,
  archiveRootId,
  limit = 10,
}: RecentlyViewedStripProps) {
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  // Pull a generous slice from the server, then filter to the
  // current scope client-side. The server returns files newest-first
  // already so the filtered list keeps that order.
  const files = useRecentlyViewedFiles(50);

  const filtered = useMemo(() => {
    if (files.length === 0) return [] as FileDto[];
    return files.filter((f) => {
      if (folderId && f.folderId !== folderId) return false;
      if (archiveRootId && f.archiveRootId !== archiveRootId) return false;
      return true;
    }).slice(0, limit);
  }, [files, folderId, archiveRootId, limit]);

  if (filtered.length === 0) return null;

  return (
    <section
      aria-labelledby="recent-strip-heading"
      className="rounded-xl border border-border bg-card p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3
          id="recent-strip-heading"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Recently viewed here
        </h3>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{filtered.length}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {filtered.map((f) => (
          <RecentThumb
            key={f.id}
            file={f}
            onOpen={() => openDetailPanel('file', f.id)}
          />
        ))}
      </div>
    </section>
  );
}

function RecentThumb({ file, onOpen }: { file: FileDto; onOpen: () => void }) {
  const cat = getMimeCategory(file.mimeType);
  const isVisual = cat === 'image' || cat === 'video';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={file.title ?? file.name}
      className={cn(
        'group block w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-all',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
      )}
    >
      <div className="relative aspect-square w-full bg-muted">
        {isVisual ? (
          <img
            src={getPreviewUrl(file.id, 'THUMBNAIL')}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            {cat}
          </div>
        )}
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] font-medium">
        {file.title ?? friendlyName(file.name)}
      </p>
    </button>
  );
}
