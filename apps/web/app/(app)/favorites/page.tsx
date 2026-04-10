'use client';

/**
 * /favorites — dedicated full-page view of every file and folder the
 * current user has starred. Mirrors the look and behaviour of the
 * archive root browser (header bar, FolderCards, FileGrid, sort +
 * media-type filter) so it feels like a first-class destination
 * rather than a sidebar dropdown.
 *
 * Data comes from `/api/favorites/expanded`, which hydrates each
 * favorite into its underlying file/folder row in a single round
 * trip — no client-side N+1.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heart, Loader2 } from 'lucide-react';

import { favorites as favoritesApi } from '@/lib/api';
import { FileGrid } from '@/components/file-grid';
import { FolderCards } from '@/components/folder-cards';
import { EmptyState } from '@/components/empty-state';
import { useAppStore } from '@/lib/store';
import { getMimeCategory } from '@harbor/utils';

type SortField = 'recent' | 'name' | 'date' | 'size' | 'type';
type SortDir = 'asc' | 'desc';
type MediaFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

export default function FavoritesPage() {
  const [sortField, setSortField] = useState<SortField>('recent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['favorites', 'expanded'],
    queryFn: favoritesApi.expanded,
  });

  const folders = data?.folders ?? [];
  const allFiles = data?.files ?? [];

  // Tell the rest of the app that the user is currently browsing the
  // favorites list, so the detail panel's "View" button (and any other
  // open-the-lightbox path) seeds the slideshow with these files
  // instead of falling back to the underlying folder of whichever
  // file the user happened to click first. Cleared on unmount so
  // navigating elsewhere immediately restores folder-based behaviour.
  const setBrowseContext = useAppStore((s) => s.setBrowseContext);
  const clearBrowseContext = useAppStore((s) => s.clearBrowseContext);
  useEffect(() => {
    if (allFiles.length > 0) {
      setBrowseContext('Favorites', allFiles);
    }
    return () => clearBrowseContext();
  }, [allFiles, setBrowseContext, clearBrowseContext]);

  // Filter and sort files. The default `recent` sort respects the
  // server-side ordering (most recently favorited first), so we
  // bypass the comparator entirely in that case to keep the original
  // sequence stable.
  const visibleFiles = useMemo(() => {
    const filtered = allFiles.filter((f) => {
      if (mediaFilter === 'all') return true;
      const cat = getMimeCategory(f.mimeType);
      if (mediaFilter === 'image') return cat === 'image';
      if (mediaFilter === 'video') return cat === 'video';
      if (mediaFilter === 'audio') return cat === 'audio';
      if (mediaFilter === 'document') return cat === 'text' || cat === 'pdf' || cat === 'document';
      return true;
    });
    if (sortField === 'recent') return filtered;
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = (a.title ?? a.name).localeCompare(b.title ?? b.name);
      else if (sortField === 'date') cmp = (a.fileModifiedAt ?? '').localeCompare(b.fileModifiedAt ?? '');
      else if (sortField === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
      else if (sortField === 'type') cmp = (a.mimeType ?? '').localeCompare(b.mimeType ?? '');
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [allFiles, mediaFilter, sortField, sortDir]);

  const fileCount = allFiles.length;
  const folderCount = folders.length;
  const isEmpty = !isLoading && fileCount === 0 && folderCount === 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-500">
            <Heart className="h-4 w-4 fill-current" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-none">Favorites</h1>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {fileCount} {fileCount === 1 ? 'file' : 'files'}
              {folderCount > 0 && ` · ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 px-2 sm:px-4">
          <select
            value={`${sortField}-${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split('-') as [SortField, SortDir];
              setSortField(f);
              setSortDir(d);
            }}
            className="hidden sm:block h-7 rounded-md border border-input bg-background px-2 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Sort"
          >
            <option value="recent-desc">Recently favorited</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="size-desc">Largest first</option>
            <option value="size-asc">Smallest first</option>
            <option value="type-asc">Type</option>
          </select>

          <select
            value={mediaFilter}
            onChange={(e) => setMediaFilter(e.target.value as MediaFilter)}
            className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Filter by type"
          >
            <option value="all">All files</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
          </select>
        </div>
      </div>

      <div className="flex-1 p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load favorites.
          </div>
        )}

        {!isLoading && !error && isEmpty && (
          <EmptyState
            icon={Heart}
            title="No favorites yet"
            description="Star files and folders from anywhere in Harbor and they'll show up here."
          />
        )}

        {!isLoading && !error && !isEmpty && (
          <div className="space-y-6">
            {folders.length > 0 && (
              <section aria-label="Favorited folders">
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Folders
                </h2>
                <FolderCards folders={folders} />
              </section>
            )}
            {visibleFiles.length > 0 && (
              <section aria-label="Favorited files">
                {folders.length > 0 && (
                  <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Files
                  </h2>
                )}
                <FileGrid files={visibleFiles} />
              </section>
            )}
            {visibleFiles.length === 0 && folders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                No files match the current filter.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
