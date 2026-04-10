'use client';

/**
 * /collections/[id] — dedicated full-page view of a single user
 * collection. Mirrors the favorites page so the two destinations
 * feel symmetric: header bar with title + count + sort/filter, then
 * FolderCards over FileGrid.
 *
 * Sets `browseContext` on mount so the lightbox slideshow runs
 * across the curated collection rather than the underlying folder
 * of whichever item the user clicks first.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Globe, LayoutList, Loader2, Lock } from 'lucide-react';

import { collections as collectionsApi } from '@/lib/api';
import { FileGrid } from '@/components/file-grid';
import { FolderCards } from '@/components/folder-cards';
import { EmptyState } from '@/components/empty-state';
import { useAppStore } from '@/lib/store';
import { getMimeCategory } from '@harbor/utils';

type SortField = 'curated' | 'name' | 'date' | 'size' | 'type';
type SortDir = 'asc' | 'desc';
type MediaFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

export default function CollectionPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [sortField, setSortField] = useState<SortField>('curated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['collection', id, 'expanded'],
    queryFn: () => collectionsApi.expanded(id),
    enabled: !!id,
  });

  const folders = data?.folders ?? [];
  const allFiles = data?.files ?? [];

  const setBrowseContext = useAppStore((s) => s.setBrowseContext);
  const clearBrowseContext = useAppStore((s) => s.clearBrowseContext);
  useEffect(() => {
    if (allFiles.length > 0 && data) {
      setBrowseContext(data.name, allFiles);
    }
    return () => clearBrowseContext();
  }, [allFiles, data, setBrowseContext, clearBrowseContext]);

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
    if (sortField === 'curated') return filtered;
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
  const isEmpty = !isLoading && !error && fileCount === 0 && folderCount === 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md"
            style={{ backgroundColor: data?.color ? `${data.color}1a` : 'rgba(99, 102, 241, 0.1)' }}
          >
            <LayoutList
              className="h-4 w-4"
              style={{ color: data?.color ?? 'rgb(99, 102, 241)' }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold leading-none">
                {data?.name ?? (isLoading ? 'Loading…' : 'Collection')}
              </h1>
              {data && (
                data.isPrivate ? (
                  <span title="Private" className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" /> Private
                  </span>
                ) : (
                  <span title="Shared" className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Globe className="h-2.5 w-2.5" /> Shared
                  </span>
                )
              )}
            </div>
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
            <option value="curated-desc">Curated order</option>
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
            Failed to load collection.
          </div>
        )}

        {isEmpty && (
          <EmptyState
            icon={LayoutList}
            title="This collection is empty"
            description="Add files or folders to it from anywhere in Harbor."
          />
        )}

        {!isLoading && !error && !isEmpty && (
          <div className="space-y-6">
            {folders.length > 0 && (
              <section aria-label="Folders in collection">
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Folders
                </h2>
                <FolderCards folders={folders} />
              </section>
            )}
            {visibleFiles.length > 0 && (
              <section aria-label="Files in collection">
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
