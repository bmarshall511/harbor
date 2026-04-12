'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { files, folders, getPreviewUrl, getFileDownloadUrl, archiveRoots } from '@/lib/api';
import type { FileDto } from '@harbor/types';
import { cn } from '@/lib/cn';
import { formatBytes, getMimeCategory, friendlyName } from '@harbor/utils';
import {
  X,
  Download,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
  Pencil,
  Trash2,
  MoreHorizontal,
  Copy,
  Maximize2,
  Play,
  CloudOff,
  Film,
  Cloud,
  HardDrive,
  Loader2,
  Camera,
  Users,
  PawPrint,
  Check,
} from 'lucide-react';
import { FileMetadataEditor, FolderMetadataEditor } from '@/components/metadata-editor';
import { trackView } from '@/lib/recently-viewed';
import { RelationPanel } from '@/components/relation-panel';
import { RenameDialog, DeleteConfirmDialog } from '@/components/file-operations';
import { ContentPreview } from '@/components/content-preview';
import { FavoriteButton } from '@/components/favorite-button';
import { CollectionButton } from '@/components/collection-button';
import { DropboxOfflinePlaceholder, useDropboxCacheState } from '@/components/dropbox-offline';
import { toast } from 'sonner';

export function DetailPanel() {
  const isOpen = useAppStore((s) => s.detailPanelOpen);
  const entityType = useAppStore((s) => s.detailPanelEntityType);
  const entityId = useAppStore((s) => s.detailPanelEntityId);
  const closeDetailPanel = useAppStore((s) => s.closeDetailPanel);

  if (!isOpen || !entityType || !entityId) return null;

  return (
    <aside
      className={cn(
        'flex flex-col border-l border-border bg-card animate-slide-in-right',
        'fixed inset-y-0 right-0 z-30 w-80 shadow-xl md:relative md:z-auto md:shadow-none',
      )}
      role="complementary"
      aria-label="Details"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">Details</h2>
        <button
          onClick={closeDetailPanel}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entityType === 'file' ? (
          <FileDetail fileId={entityId} />
        ) : (
          <FolderDetail folderId={entityId} />
        )}
      </div>
    </aside>
  );
}

function FileDetail({ fileId }: { fileId: string }) {
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const openViewer = useAppStore((s) => s.openViewer);
  const browseContextFiles = useAppStore((s) => s.browseContextFiles);
  const queryClient = useQueryClient();

  // Track view for recently-viewed
  useEffect(() => { trackView(fileId); }, [fileId]);

  const { data: file, isLoading } = useQuery({
    queryKey: ['file', fileId],
    queryFn: () => files.get(fileId),
  });

  // Fetch the file's siblings (all files in the same folder, or in the
  // same archive root if it's a top-level file). The viewer needs the
  // full list so the user can navigate / run a slideshow across every
  // image and video in the current directory — not just the one file
  // they happened to open the detail panel from.
  const { data: siblings } = useQuery({
    queryKey: file
      ? file.folderId
        ? ['files', 'by-folder', file.folderId]
        : ['files', 'by-root', file.archiveRootId]
      : ['files', 'siblings', 'noop'],
    queryFn: () => {
      if (!file) return Promise.resolve([] as FileDto[]);
      return file.folderId
        ? files.listByFolder(file.folderId)
        : files.listByArchiveRoot(file.archiveRootId);
    },
    enabled: !!file,
  });

  // Filter to viewable items only (images + videos), preserving order.
  // If the current file isn't in the resolved sibling list for any
  // reason (edge case: cache miss, race), include it explicitly so the
  // viewer always opens on at least the file the user clicked.
  const viewableSiblings = useMemo(() => {
    if (!file) return [] as FileDto[];
    const list = siblings ?? [];
    const viewable = list.filter((f) => {
      const c = getMimeCategory(f.mimeType);
      return c === 'image' || c === 'video';
    });
    if (viewable.some((f) => f.id === file.id)) return viewable;
    // Edge case: insert the current file at the front so the viewer
    // still has at least one item to render.
    return [file, ...viewable];
  }, [file, siblings]);

  // Open the lightbox seeded with the FULL viewable list — not just
  // the file the user clicked. Resolution order:
  //
  //   1. `browseContextFiles` (set by /favorites, /collections, etc.)
  //      — when present, the user is browsing a curated list and the
  //      slideshow should run across THAT list, not the underlying
  //      folder of whichever item they happened to click first.
  //   2. Cached folder siblings from the `useQuery` above (fast path).
  //   3. On-demand fetch via `queryClient.fetchQuery` so the viewer
  //      never opens with a 1/1 list while siblings are still loading.
  const handleOpenViewer = useCallback(async () => {
    if (!file) return;

    // 1. Browse-context override.
    if (browseContextFiles && browseContextFiles.length > 0) {
      const viewable = browseContextFiles.filter((f) => {
        const c = getMimeCategory(f.mimeType);
        return c === 'image' || c === 'video';
      });
      const list = viewable.some((f) => f.id === file.id) ? viewable : [file, ...viewable];
      openViewer(file.id, list.length > 0 ? list : [file]);
      return;
    }

    // 2. Fast path: siblings already cached.
    if (viewableSiblings.length > 1) {
      openViewer(file.id, viewableSiblings);
      return;
    }

    // Slow path: fetch siblings on demand. We mirror the queryKey from
    // the `useQuery` above so React Query dedupes / caches the result.
    const siblingsList = await queryClient.fetchQuery({
      queryKey: file.folderId
        ? ['files', 'by-folder', file.folderId]
        : ['files', 'by-root', file.archiveRootId],
      queryFn: () =>
        file.folderId
          ? files.listByFolder(file.folderId)
          : files.listByArchiveRoot(file.archiveRootId),
    });

    const viewable = (siblingsList ?? []).filter((f) => {
      const c = getMimeCategory(f.mimeType);
      return c === 'image' || c === 'video';
    });
    const list = viewable.some((f) => f.id === file.id) ? viewable : [file, ...viewable];
    openViewer(file.id, list.length > 0 ? list : [file]);
  }, [file, viewableSiblings, openViewer, queryClient, browseContextFiles]);

  if (isLoading || !file) {
    return (
      <div className="space-y-4 p-4">
        <div className="aspect-video animate-pulse rounded-lg bg-muted" />
        <div className="h-6 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const category = getMimeCategory(file.mimeType);
  const hasPreview = category === 'image' || file.previews?.length > 0;
  const isVideo = category === 'video';
  const isOfflineStub = file.size === 0;

  return (
    <div className="space-y-4 p-4">
      {/* Preview — routes Dropbox files that aren't cached yet
          through the smart "Make available offline" flow before
          rendering the real preview. */}
      <DetailPreviewSurface
        file={file}
        isVideo={isVideo}
        hasPreview={!!hasPreview}
        onView={() => handleOpenViewer()}
      />
      {/* Generic fallback if ContentPreview returns nothing */}
      {!hasPreview && !isVideo && !file.mimeType?.startsWith('text/') && file.mimeType !== 'application/json' && file.mimeType !== 'application/pdf' && (
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          <FileIconLarge mimeType={file.mimeType} />
        </div>
      )}

      {/* Title + actions */}
      <div>
        <h3 className="text-sm font-semibold" title={file.name}>{file.title ?? friendlyName(file.name)}</h3>
        {(file.title || friendlyName(file.name) !== file.name) && (
          <button
            onClick={() => { navigator.clipboard.writeText(file.name); toast.success('Filename copied'); }}
            className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground group"
            title="Click to copy original filename"
          >
            <span className="truncate font-mono">{file.name}</span>
            <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <div className="mt-2 flex items-center gap-1">
          {(category === 'image' || category === 'video') && (
            <button
              onClick={() => handleOpenViewer()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Maximize2 className="h-3 w-3" />
              View
            </button>
          )}
          <a
            href={getFileDownloadUrl(file.id)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
            download
          >
            <Download className="h-3 w-3" />
          </a>
          <FavoriteButton entityType="FILE" entityId={file.id} />
          <CollectionButton entityType="FILE" entityId={file.id} />
          <button
            onClick={() => setShowRename(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Dropbox offline cache control */}
      <DropboxCacheControl fileId={file.id} archiveRootId={file.archiveRootId} />

      {/* File info — grouped and polished */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
        {/* Essential info — width/height/duration live in meta.fields now */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <InfoItem label="Size" value={formatBytes(file.size)} />
          <InfoItem label="Type" value={file.mimeType?.split('/')[1]?.toUpperCase() ?? '—'} />
          {(() => {
            const width = file.meta?.fields?.width as number | undefined;
            const height = file.meta?.fields?.height as number | undefined;
            return width && height
              ? <InfoItem label="Dimensions" value={`${width}\u00D7${height}`} />
              : null;
          })()}
          {(() => {
            const duration = file.meta?.fields?.duration as number | undefined;
            return duration != null
              ? <InfoItem label="Duration" value={formatDuration(duration)} />
              : null;
          })()}
        </div>

        {/* Dates */}
        {(file.fileCreatedAt || file.fileModifiedAt) && (
          <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {file.fileCreatedAt && <InfoItem label="Created" value={new Date(file.fileCreatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />}
            {file.fileModifiedAt && <InfoItem label="Modified" value={new Date(file.fileModifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />}
          </div>
        )}

        {/* Technical — file + path are full-width, fully readable
            (wrap, never truncated), one-click copyable, and the file
            row has an inline rename button. */}
        <div className="border-t border-border/50 pt-2 space-y-2 text-xs">
          <CopyableRow
            label="File"
            value={file.name}
            extraAction={
              <button
                onClick={() => setShowRename(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Rename file"
                title="Rename file"
              >
                <Pencil className="h-3 w-3" />
              </button>
            }
          />
          <CopyableRow label="Path" value={file.path} />
          {file.hash && (
            <CopyableRow label="Hash" value={file.hash} mono truncateMiddle />
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 w-12">Status</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium',
              file.status === 'INDEXED' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'
            )}>{file.status}</span>
          </div>
          {file.previews?.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0 w-12">Previews</span>
              <span className="text-[10px]">{file.previews.length} cached</span>
            </div>
          )}
        </div>
      </div>

      {/* Metadata editor with tags */}
      <div className="border-t border-border pt-3">
        <FileMetadataEditor file={file} />
      </div>

      {/* Set as avatar — only for image files */}
      {file.mimeType?.startsWith('image/') && (
        <SetAsAvatarSection fileId={file.id} />
      )}

      {/* AI Tags (read-only) — sourced from meta.fields.aiTags */}
      {(() => {
        const aiTags = file.meta?.fields?.aiTags;
        if (!Array.isArray(aiTags) || aiTags.length === 0) return null;
        return (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Tags</h4>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(aiTags as string[]).map((tag) => (
                <span key={tag} className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Relations */}
      <div className="border-t border-border pt-3">
        <RelationPanel entityType="FILE" entityId={file.id} />
      </div>

      {/* Dialogs */}
      {showRename && (
        <RenameDialog
          entityType="file"
          entityId={file.id}
          currentName={file.name}
          mimeType={file.mimeType}
          fileCreatedAt={file.fileCreatedAt}
          fileModifiedAt={file.fileModifiedAt}
          onClose={() => setShowRename(false)}
        />
      )}
      {showDelete && (
        <DeleteConfirmDialog entityType="file" entityId={file.id} entityName={file.name} onClose={() => setShowDelete(false)} />
      )}
    </div>
  );
}

function FolderDetail({ folderId }: { folderId: string }) {
  const [showDelete, setShowDelete] = useState(false);

  const { data: folder, isLoading } = useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => folders.get(folderId),
  });

  if (isLoading || !folder) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-6 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold">{folder.name}</h3>
        <div className="mt-2 flex items-center gap-1">
          <button
            onClick={() => {
              navigator.clipboard.writeText(folder.id);
              toast.success('ID copied');
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy ID"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            aria-label="Delete folder"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <MetaRow label="Files" value={String(folder.fileCount ?? 0)} />
        <MetaRow label="Subfolders" value={String(folder.childCount ?? 0)} />
      </div>

      {/* Metadata editor with tags */}
      <div className="border-t border-border pt-3">
        <FolderMetadataEditor folder={folder} />
      </div>

      {/* Relations */}
      <div className="border-t border-border pt-3">
        <RelationPanel entityType="FOLDER" entityId={folder.id} />
      </div>

      {showDelete && (
        <DeleteConfirmDialog entityType="folder" entityId={folder.id} entityName={folder.name} onClose={() => setShowDelete(false)} />
      )}
    </div>
  );
}

function DropboxCacheControl({ fileId, archiveRootId }: { fileId: string; archiveRootId: string }) {
  const queryClient = useQueryClient();

  const { data: root } = useQuery({
    queryKey: ['archive-root', archiveRootId],
    queryFn: () => archiveRoots.get(archiveRootId),
  });

  const { data: cacheStatus } = useQuery({
    queryKey: ['file-cache', fileId],
    queryFn: () => files.cacheStatus(fileId),
    enabled: root?.providerType === 'DROPBOX',
  });

  // Indeterminate progress while the request is in flight. The
  // server doesn't stream byte-progress today (Dropbox SDK reads the
  // whole file in one shot), so we run a smooth fake progress that
  // never reaches 100% until the request actually resolves. The bar
  // gives the user *something* to look at instead of a single spinner.
  const [progress, setProgress] = useState(0);

  const cacheMutation = useMutation({
    mutationFn: async () => {
      // Reset and start a smooth fake-progress timer.
      setProgress(2);
      const timer = window.setInterval(() => {
        setProgress((p) => (p >= 92 ? p : p + Math.max(0.5, (92 - p) * 0.08)));
      }, 200);
      try {
        return await files.cacheOffline(fileId);
      } finally {
        window.clearInterval(timer);
      }
    },
    onSuccess: () => {
      setProgress(100);
      // Refresh everything that depends on this file's cached state:
      // the cache-status query, the file record (so previews update),
      // any folder listing it appears in, and any active dashboard view.
      queryClient.invalidateQueries({ queryKey: ['file-cache', fileId] });
      queryClient.invalidateQueries({ queryKey: ['file', fileId] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('File cached for offline viewing');
      // Reset the bar shortly after so the next caching action starts fresh.
      window.setTimeout(() => setProgress(0), 600);
    },
    onError: (err: Error) => {
      setProgress(0);
      toast.error(err.message);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => files.clearCache(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-cache', fileId] });
      queryClient.invalidateQueries({ queryKey: ['file', fileId] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast.success('Offline cache cleared');
    },
  });

  // Only show for Dropbox files
  if (root?.providerType !== 'DROPBOX') return null;

  const downloading = cacheMutation.isPending;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-2">
        {cacheStatus?.cached ? (
          <>
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-green-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-green-600 dark:text-green-400">Available offline</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(cacheStatus.cacheSize)} cached</p>
            </div>
            <button
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <Cloud className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium">
                {downloading ? 'Downloading…' : 'Dropbox only'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {downloading ? `${Math.round(progress)}%` : 'Not cached locally'}
              </p>
            </div>
            <button
              onClick={() => cacheMutation.mutate()}
              disabled={downloading}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {downloading ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Caching...</>
              ) : (
                <><Download className="h-3 w-3" /> Make offline</>
              )}
            </button>
          </>
        )}
      </div>
      {/* Progress bar — only visible while caching */}
      {downloading && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Decides which preview component to render in the detail panel:
 *
 *   • Dropbox file with no cached bytes → smart offline placeholder
 *     with the "Make available offline" CTA
 *   • Anything else → the existing video/image/content previews
 *
 * `useDropboxCacheState` tells us whether the bytes are streamable
 * right now. We don't gate on it for purely local files since the
 * placeholder doesn't apply there.
 */
function DetailPreviewSurface({
  file,
  isVideo,
  hasPreview,
  onView,
}: {
  file: FileDto;
  isVideo: boolean;
  hasPreview: boolean;
  onView: () => void;
}) {
  const cacheState = useDropboxCacheState(file.id);
  // Wait for the cache state before mounting any preview component
  // — otherwise a Dropbox preview that isn't streamable will fire a
  // /preview request that 404s and leaves the browser stuck on the
  // native loader forever.
  if (cacheState.isLoading || !cacheState.data) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-border bg-muted/30">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (cacheState.data.providerType === 'DROPBOX' && cacheState.data.streamable !== true) {
    return <DropboxOfflinePlaceholder fileId={file.id} variant="detail" />;
  }

  if (isVideo) {
    return <VideoPreview file={file} onView={onView} />;
  }
  if (hasPreview) {
    return (
      <ImagePreview
        fileId={file.id}
        alt={(file.meta?.fields?.altText as string | undefined) ?? file.name}
      />
    );
  }
  return <ContentPreview fileId={file.id} mimeType={file.mimeType} />;
}

function VideoPreview({ file, onView }: { file: any; onView: () => void }) {
  const hasThumb = file.previews?.length > 0;
  const isOffline = file.size === 0;

  if (isOffline) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-lg border border-border bg-amber-500/5">
        <CloudOff className="h-8 w-8 text-amber-400/50" />
        <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">Not available offline</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">Open Dropbox to download</p>
      </div>
    );
  }

  return (
    <button
      onClick={onView}
      className="group relative w-full overflow-hidden rounded-lg border border-border bg-muted"
    >
      {hasThumb ? (
        <img
          src={getPreviewUrl(file.id, 'MEDIUM')}
          alt={file.name}
          className="w-full object-contain"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-gradient-to-b from-purple-500/10 to-purple-500/5">
          <FileVideo className="h-10 w-10 text-purple-400/40" />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
        <div className="rounded-full bg-black/50 p-3 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all">
          <Play className="h-5 w-5 text-white fill-white" />
        </div>
      </div>
      {(() => {
        const duration = (file.meta?.fields?.duration as number | undefined) ?? null;
        if (duration == null) return null;
        return (
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
            {formatDetailDuration(duration)}
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white/70">
        {file.mimeType?.split('/')[1] ?? 'video'}
      </div>
    </button>
  );
}

function formatDetailDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ImagePreview({ fileId, alt }: { fileId: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
      {!loaded && !error && (
        <div className="flex aspect-video items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      {error ? (
        <div className="flex aspect-video items-center justify-center">
          <div className="text-center">
            <FileImage className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-1 text-xs text-muted-foreground">Preview unavailable</p>
          </div>
        </div>
      ) : (
        <img
          src={getPreviewUrl(fileId, 'MEDIUM')}
          alt={alt}
          className={cn('w-full object-contain transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0 absolute inset-0')}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

/**
 * A label/value row used for filename, path, and hash in the detail
 * panel. The value is selectable text (so the user can highlight
 * just part of it) and a one-click copy button copies the whole
 * thing. Long values wrap on word boundaries — never truncated.
 */
function CopyableRow({
  label,
  value,
  mono = true,
  truncateMiddle = false,
  extraAction,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncateMiddle?: boolean;
  extraAction?: React.ReactNode;
}) {
  const display = truncateMiddle && value.length > 24
    ? `${value.slice(0, 10)}…${value.slice(-10)}`
    : value;
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-12 pt-px">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 select-text break-all leading-snug text-foreground',
          mono && 'font-mono text-[10px]',
        )}
        title={value}
      >
        {display}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
        {extraAction}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-20 text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function FileIconLarge({ mimeType }: { mimeType: string | null }) {
  const category = getMimeCategory(mimeType);
  const icons: Record<string, typeof File> = {
    image: FileImage, video: FileVideo, audio: FileAudio,
    text: FileText, pdf: FileText, document: FileText,
  };
  const Icon = icons[category] ?? File;
  return <Icon className="h-16 w-16 text-muted-foreground/30" aria-hidden="true" />;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Set as Avatar ────────────────────────────────────────────────────────────

/**
 * "Use as avatar" section — lets admins assign the current image file
 * as the avatar for any person or pet. Shows a dropdown of known
 * persons with a "Set as photo" button.
 */
function SetAsAvatarSection({ fileId }: { fileId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [setting, setSetting] = useState<string | null>(null);

  const { data: persons } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      if (!res.ok) return [];
      return res.json() as Promise<Array<{
        id: string | null;
        name: string | null;
        avatarUrl: string | null;
        avatarFileId?: string | null;
        entityType?: string;
        source: string;
      }>>;
    },
    enabled: open,
  });

  const dbPersons = (persons ?? []).filter((p) => p.source === 'record' && p.id && p.name);
  const filtered = dbPersons.filter((p) =>
    !search || p.name!.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSet = async (personId: string, personName: string) => {
    setSetting(personId);
    try {
      const res = await fetch(`/api/persons/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarFileId: fileId }),
      });
      if (!res.ok) throw new Error('Failed');
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      const { toast } = await import('sonner');
      toast.success(`Set as ${personName}'s photo`);
    } catch {
      const { toast } = await import('sonner');
      toast.error('Failed to set avatar');
    } finally {
      setSetting(null);
    }
  };

  if (!open) {
    return (
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition"
        >
          <Camera className="h-3.5 w-3.5" />
          Use as avatar for a person or pet
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" />
            Set as avatar
          </h4>
          <button
            type="button"
            onClick={() => { setOpen(false); setSearch(''); }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people & pets..."
          className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filtered.slice(0, 30).map((p) => {
            const isPet = p.entityType === 'PET';
            const isCurrentAvatar = p.avatarFileId === fileId;
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition">
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt="" className={cn('h-7 w-7 object-cover', isPet ? 'rounded-lg' : 'rounded-full')} />
                ) : (
                  <div className={cn('flex h-7 w-7 items-center justify-center', isPet ? 'rounded-lg bg-amber-500/10' : 'rounded-full bg-muted')}>
                    {isPet ? <PawPrint className="h-3 w-3 text-amber-500" /> : <Users className="h-3 w-3 text-muted-foreground" />}
                  </div>
                )}
                <span className="flex-1 truncate font-medium">{p.name}</span>
                {isCurrentAvatar ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-600">
                    <Check className="h-3 w-3" /> Current
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSet(p.id!, p.name!)}
                    disabled={setting === p.id}
                    className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {setting === p.id ? 'Setting...' : 'Set'}
                  </button>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              {search ? 'No matches' : 'No people or pets yet'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
