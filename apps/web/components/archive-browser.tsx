'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { folders, files, jobs as jobsApi } from '@/lib/api';
import { FileGrid } from '@/components/file-grid';
import { RecommendationStrip } from '@/components/recommendation-strip';
import { RecentlyViewedStrip } from '@/components/recently-viewed-strip';
import { FileList } from '@/components/file-list';
import { FolderCards } from '@/components/folder-cards';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { EmptyState } from '@/components/empty-state';
import { CreateFolderDialog } from '@/components/file-operations';
import { BatchToolbar } from '@/components/batch-toolbar';
import { FolderOpen, FolderPlus, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { fetchApi } from '@/lib/fetch-api';
import { getMimeCategory, formatBytes } from '@harbor/utils';
import { toast } from 'sonner';

type SortField = 'name' | 'date' | 'size' | 'type';
type SortDir = 'asc' | 'desc';
type MediaFilter = 'all' | 'image' | 'video' | 'audio' | 'document';

export function ArchiveBrowser({ archiveRootId }: { archiveRootId: string }) {
  const activeFolderId = useAppStore((s) => s.activeFolderId);
  const viewMode = useAppStore((s) => s.viewMode);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const { data: childFolders, isLoading: foldersLoading, error: foldersError } = useQuery({
    queryKey: activeFolderId
      ? ['folders', 'children', activeFolderId]
      : ['folders', 'root', archiveRootId],
    queryFn: () =>
      activeFolderId
        ? folders.listChildren(activeFolderId)
        : folders.listRoot(archiveRootId),
    retry: 2,
  });

  const { data: folderFiles, isLoading: filesLoading, error: filesError } = useQuery({
    queryKey: activeFolderId
      ? ['files', 'folder', activeFolderId]
      : ['files', 'root', archiveRootId],
    queryFn: () =>
      activeFolderId
        ? files.listByFolder(activeFolderId)
        : files.listByArchiveRoot(archiveRootId),
    retry: 2,
  });

  const isLoading = foldersLoading || filesLoading;
  const hasError = foldersError || filesError;

  // Apply filter and sort to files
  const filteredFiles = (folderFiles ?? []).filter((f) => {
    if (mediaFilter === 'all') return true;
    const cat = getMimeCategory(f.mimeType);
    if (mediaFilter === 'image') return cat === 'image';
    if (mediaFilter === 'video') return cat === 'video';
    if (mediaFilter === 'audio') return cat === 'audio';
    if (mediaFilter === 'document') return cat === 'text' || cat === 'pdf' || cat === 'document';
    return true;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') cmp = (a.title ?? a.name).localeCompare(b.title ?? b.name);
    else if (sortField === 'date') cmp = (a.fileModifiedAt ?? '').localeCompare(b.fileModifiedAt ?? '');
    else if (sortField === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else if (sortField === 'type') cmp = (a.mimeType ?? '').localeCompare(b.mimeType ?? '');
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const isEmpty = !childFolders?.length && !sortedFiles.length;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border">
        <Breadcrumbs archiveRootId={archiveRootId} folderId={activeFolderId} />
        <div className="flex items-center gap-1 px-2 sm:px-4">
          {/* Sort */}
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
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="size-desc">Largest first</option>
            <option value="size-asc">Smallest first</option>
            <option value="type-asc">Type</option>
          </select>

          {/* Filter */}
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

          <button
            onClick={() => setShowCreateFolder(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Create folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </button>
        </div>
      </div>

      {showCreateFolder && (
        <CreateFolderDialog
          archiveRootId={archiveRootId}
          parentId={activeFolderId}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {isLoading ? (
        <LoadingSkeleton viewMode={viewMode} />
      ) : hasError ? (
        <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Failed to load</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {(foldersError as Error)?.message || (filesError as Error)?.message || 'Could not load files and folders. This may be a temporary connection issue.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      ) : isEmpty ? (
        <ArchiveEmptyState archiveRootId={archiveRootId} isRootLevel={!activeFolderId} />
      ) : (
        <div className="flex flex-1 flex-col animate-fade-in">
          <BatchToolbar />

          {/* ── Compact directory header ────────────────────────── */}
          {((childFolders?.length ?? 0) > 0 || sortedFiles.length > 0) && (
            <DirectoryHeader folders={childFolders ?? []} files={folderFiles ?? []} />
          )}

          <div className="flex flex-1 flex-col p-4 space-y-6">
            {/* ── Inline recommendation + recently viewed strips ─── */}
            {/* These sit above the folder/file grid as compact,
                self-contained sections. They auto-hide when empty
                so an empty archive just shows folders + files. */}
            <RecommendationStrip
              scope={{
                archiveRootId: activeFolderId ? undefined : archiveRootId,
                folderId: activeFolderId ?? undefined,
              }}
            />
            <RecentlyViewedStrip
              archiveRootId={activeFolderId ? undefined : archiveRootId}
              folderId={activeFolderId ?? undefined}
            />

            {/* ── Folders ──────────────────────────────────────────── */}
            {childFolders && childFolders.length > 0 && (
              <section aria-label="Folders">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Folders
                </h2>
                <FolderCards folders={childFolders} />
              </section>
            )}

            {/* ── Files ────────────────────────────────────────────── */}
            {sortedFiles.length > 0 && (
              <section
                aria-label="Files"
                className={cn(sortedFiles.length > 60 ? 'flex flex-1 flex-col min-h-[400px]' : '')}
              >
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Files ({sortedFiles.length}
                  {mediaFilter !== 'all' ? ` ${mediaFilter}` : ''}
                  {folderFiles && sortedFiles.length !== folderFiles.length ? ` of ${folderFiles.length}` : ''})
                </h2>
                <div className={sortedFiles.length > 60 ? 'flex-1' : ''}>
                  {viewMode === 'grid' ? (
                    <FileGrid files={sortedFiles} />
                  ) : (
                    <FileList files={sortedFiles} />
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectoryHeader({ folders, files: allFiles }: { folders: any[]; files: any[] }) {
  const imageCt = allFiles.filter((f) => getMimeCategory(f.mimeType) === 'image').length;
  const videoCt = allFiles.filter((f) => getMimeCategory(f.mimeType) === 'video').length;
  const audioCt = allFiles.filter((f) => getMimeCategory(f.mimeType) === 'audio').length;
  const docCt = allFiles.length - imageCt - videoCt - audioCt;
  const totalSize = allFiles.reduce((sum, f) => sum + (f.size ?? 0), 0);

  const total = allFiles.length || 1;
  const typeBar = [
    { pct: (imageCt / total) * 100, color: 'bg-blue-500', label: 'Images', count: imageCt },
    { pct: (videoCt / total) * 100, color: 'bg-purple-500', label: 'Videos', count: videoCt },
    { pct: (audioCt / total) * 100, color: 'bg-amber-500', label: 'Audio', count: audioCt },
    { pct: (docCt / total) * 100, color: 'bg-green-500', label: 'Docs', count: docCt },
  ].filter((t) => t.pct > 0);

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tabular-nums">{allFiles.length.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">items</span>
        </div>
        {folders.length > 0 && (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{folders.length}</span>{' '}
            folder{folders.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{formatBytes(totalSize)}</span>

        {/* Inline type bar */}
        {typeBar.length > 0 && (
          <div className="flex min-w-[180px] flex-1 items-center gap-3">
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              {typeBar.map((t, i) => (
                <div
                  key={i}
                  className={cn('h-full', t.color)}
                  style={{ width: `${Math.max(t.pct, 1)}%` }}
                  title={`${t.label}: ${t.count}`}
                />
              ))}
            </div>
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              {imageCt > 0 && <Dot color="bg-blue-500" label={`${imageCt}`} />}
              {videoCt > 0 && <Dot color="bg-purple-500" label={`${videoCt}`} />}
              {audioCt > 0 && <Dot color="bg-amber-500" label={`${audioCt}`} />}
              {docCt > 0 && <Dot color="bg-green-500" label={`${docCt}`} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} />
      {label}
    </span>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: string }) {
  return (
    <div className="p-4">
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
            : 'space-y-1'
        }
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className={
              viewMode === 'grid'
                ? 'aspect-square animate-pulse rounded-lg bg-muted'
                : 'h-10 animate-pulse rounded-md bg-muted'
            }
          />
        ))}
      </div>
    </div>
  );
}

function ArchiveEmptyState({ archiveRootId, isRootLevel }: { archiveRootId: string; isRootLevel: boolean }) {
  const { data: allJobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => jobsApi.list(),
    refetchInterval: 5000,
  });

  const latestJob = (allJobs as any[])?.find?.((j: any) =>
    j.type === 'index' && j.metadata?.archiveRootId === archiveRootId
  );

  const [reindexing, setReindexing] = useState(false);

  const handleReindex = () => {
    setReindexing(true);
    // Fire the request but don't await — it runs synchronously on the
    // server for up to 120s. The IndexingStatus component polls for
    // progress. We just need to know the request was accepted.
    fetch('/api/indexing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveRootId }),
    }).then((res) => {
      if (!res.ok) res.json().then((d) => toast.error(d.message ?? 'Failed'));
    }).catch(() => {
      toast.error('Failed to start indexing');
    });
    toast.success('Indexing started — progress will appear in the header');
    // The reindexing state will be cleared when the jobs poll picks
    // up the RUNNING status and the archive-browser shows its own
    // indexing state.
    setTimeout(() => setReindexing(false), 3000);
  };

  // Indexing is running
  if (latestJob?.status === 'RUNNING' || latestJob?.status === 'QUEUED') {
    const progress = latestJob.progress != null ? Math.round(latestJob.progress * 100) : null;
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {latestJob.status === 'QUEUED' ? 'Waiting to index...' : 'Indexing in progress'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Files will appear here once indexing completes.
        </p>
        {progress !== null && progress > 0 && (
          <div className="mt-4 w-48">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{progress}% complete</p>
          </div>
        )}
      </div>
    );
  }

  // Indexing failed
  if (latestJob?.status === 'FAILED' && isRootLevel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Indexing failed</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {latestJob.error}
        </p>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="mt-4 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {reindexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {reindexing ? 'Starting...' : 'Retry Indexing'}
        </button>
      </div>
    );
  }

  // Never indexed
  if (!latestJob && isRootLevel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="rounded-full bg-muted p-4">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Not yet indexed</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          This archive root needs to be indexed before files will appear.
        </p>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="mt-4 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {reindexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {reindexing ? 'Starting...' : 'Start Indexing'}
        </button>
      </div>
    );
  }

  // Default: regular empty folder
  return (
    <EmptyState
      icon={FolderOpen}
      title="This folder is empty"
      description="Drop files here or create a subfolder to get started."
    />
  );
}
