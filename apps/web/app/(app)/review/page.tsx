'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { review as reviewApi, getPreviewUrl, archiveRoots as archiveRootsApi, files as filesApi, folders } from '@/lib/api';
import type { ReviewQueueItem } from '@/lib/api';
import type { FileDto } from '@harbor/types';
import { cn } from '@/lib/cn';
import { getMimeCategory, friendlyName, formatBytes } from '@harbor/utils';
import { FileMetadataEditor } from '@/components/metadata-editor';
import { FavoriteButton } from '@/components/favorite-button';
import { CollectionButton } from '@/components/collection-button';
import { RenameDialog } from '@/components/file-operations';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Loader2,
  Filter,
  X,
  Keyboard,
  Maximize2,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
  Sparkles,
  CheckCircle2,
  FolderOpen,
  Pencil,
  RefreshCw,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

// ─── Session persistence ──────────────────────────────────────

const STORAGE_KEY = 'harbor-review-session';

interface ReviewSession {
  currentIndex: number;
  filters: string[];
  rootFilter: string;
  folderFilter: string;
  reviewedToday: number;
  sessionDate: string;
}

function loadSession(): ReviewSession {
  if (typeof window === 'undefined') return defaultSession();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSession();
    const s = JSON.parse(raw) as ReviewSession;
    // Reset counter if it's a new day
    if (s.sessionDate !== new Date().toISOString().slice(0, 10)) {
      return { ...s, reviewedToday: 0, sessionDate: new Date().toISOString().slice(0, 10) };
    }
    return s;
  } catch {
    return defaultSession();
  }
}

function defaultSession(): ReviewSession {
  return {
    currentIndex: 0,
    filters: [],
    rootFilter: '',
    folderFilter: '',
    reviewedToday: 0,
    sessionDate: new Date().toISOString().slice(0, 10),
  };
}

function saveSession(session: ReviewSession) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

// ─── Review Page ──────────────────────────────────────────────

export default function ReviewPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<ReviewSession>(loadSession);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // History of visited items so Previous always works.
  // Items are appended as we advance through the queue.
  const [history, setHistory] = useState<ReviewQueueItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Persist session changes
  useEffect(() => { saveSession(session); }, [session]);

  const filterString = session.filters.join(',');

  // Fetch queue
  const { data, isLoading } = useQuery({
    queryKey: ['review-queue', filterString, session.rootFilter, session.folderFilter],
    queryFn: () => reviewApi.queue({
      limit: 50,
      filter: filterString || undefined,
      root: session.rootFilter || undefined,
      folder: session.folderFilter || undefined,
    }),
    staleTime: 60_000,
  });

  // Archive roots for filter dropdown
  const { data: roots } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: archiveRootsApi.list,
  });

  const queueItems = data?.items ?? [];

  // The next unvisited item from the queue (skip any already in history)
  const visitedIds = useMemo(() => new Set(history.map((h) => h.file.id)), [history]);
  const nextFromQueue = useMemo(
    () => queueItems.find((item) => !visitedIds.has(item.file.id)) ?? null,
    [queueItems, visitedIds],
  );

  // Seed history with the first queue item on initial load
  useEffect(() => {
    if (history.length === 0 && queueItems.length > 0) {
      setHistory([queueItems[0]!]);
      setHistoryIndex(0);
    }
  }, [history.length, queueItems]);

  // Current item: either from history (when going back) or next from queue
  const currentItem = historyIndex >= 0 && historyIndex < history.length
    ? history[historyIndex]!
    : null;

  // Mark as reviewed
  const markReviewed = useMutation({
    mutationFn: (fileId: string) => reviewApi.markReviewed(fileId),
    onSuccess: () => {
      // Only update the sidebar badge count, don't refetch the queue
      queryClient.invalidateQueries({ queryKey: ['review-queue-count'] });
    },
  });

  const advance = useCallback((countAsReviewed: boolean) => {
    if (!currentItem) return;
    setDirection(1);
    markReviewed.mutate(currentItem.file.id);

    // Find the next unvisited item
    const currentVisited = new Set(history.map((h) => h.file.id));
    const next = queueItems.find((item) => !currentVisited.has(item.file.id));

    if (next) {
      // Trim any forward history (if user went back then advances again)
      const trimmed = history.slice(0, historyIndex + 1);
      setHistory([...trimmed, next]);
      setHistoryIndex(trimmed.length);
    }
    // else: no more items, stay on current

    if (countAsReviewed) {
      setSession((s) => ({ ...s, reviewedToday: s.reviewedToday + 1 }));
    }
  }, [currentItem, history, historyIndex, queueItems, markReviewed]);

  const goNext = useCallback(() => advance(true), [advance]);

  // "Done" — mark as reviewed but stay on the current item
  const goDone = useCallback(() => {
    if (!currentItem) return;
    markReviewed.mutate(currentItem.file.id);
    setSession((s) => ({ ...s, reviewedToday: s.reviewedToday + 1 }));
    toast.success('Marked as reviewed');
  }, [currentItem, markReviewed]);

  const goPrev = useCallback(() => {
    if (historyIndex <= 0) return;
    setDirection(-1);
    setHistoryIndex((i) => i - 1);
  }, [historyIndex]);

  const toggleFilter = useCallback((filter: string) => {
    setSession((s) => {
      const next = s.filters.includes(filter)
        ? s.filters.filter((f) => f !== filter)
        : [...s.filters, filter];
      return { ...s, filters: next, currentIndex: 0 };
    });
    setHistory([]);
    setHistoryIndex(-1);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'd':
        case 'D':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            goDone();
          }
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts((v) => !v);
          break;
        case 'Escape':
          setShowShortcuts(false);
          setShowFilters(false);
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goDone]);

  // Focus container on mount for keyboard capture
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (queueItems.length === 0) {
    return <ReviewEmptyState filters={session.filters} onClearFilters={() => { setSession((s) => ({ ...s, filters: [], rootFilter: '', folderFilter: '' })); setHistory([]); setHistoryIndex(-1); }} />;
  }

  const totalNeedsReview = data?.needsReviewCount ?? 0;
  const progress = totalNeedsReview > 0
    ? Math.round(((data?.reviewedCount ?? 0) / (data?.totalCount ?? 1)) * 100)
    : 100;

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col outline-none"
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold">Review</h1>
            <p className="text-[11px] text-muted-foreground">
              {historyIndex + 1} of {history.length} viewed
              {totalNeedsReview > 0 && (
                <span> &middot; {totalNeedsReview.toLocaleString()} need review</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stats pill */}
          {session.reviewedToday > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-[11px] font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              {session.reviewedToday} reviewed today
            </div>
          )}

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{progress}%</span>
          </div>

          {/* Filter button */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              showFilters || session.filters.length > 0 || session.rootFilter || session.folderFilter
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {(() => {
              const count = session.filters.length + (session.rootFilter ? 1 : 0) + (session.folderFilter ? 1 : 0);
              return count > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {count}
                </span>
              ) : null;
            })()}
          </button>

          {/* Keyboard shortcut hint */}
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <FilterBar
          filters={session.filters}
          rootFilter={session.rootFilter}
          folderFilter={session.folderFilter}
          roots={roots ?? []}
          onToggleFilter={toggleFilter}
          onSetRoot={(root) => {
            setSession((s) => ({ ...s, rootFilter: root, folderFilter: '', currentIndex: 0 }));
            setHistory([]);
            setHistoryIndex(-1);
          }}
          onSetFolder={(folder) => {
            setSession((s) => ({ ...s, folderFilter: folder, currentIndex: 0 }));
            setHistory([]);
            setHistoryIndex(-1);
          }}
        />
      )}

      {/* Main content — review card */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {currentItem && (
            <motion.div
              key={currentItem.file.id}
              initial={{ opacity: 0, x: direction * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -60 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="h-full"
            >
              <ReviewCard item={currentItem} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 bg-card/50 backdrop-blur-sm">
        <button
          onClick={goPrev}
          disabled={historyIndex <= 0}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        {/* Context: folder info */}
        {currentItem && (
          <FolderContext file={currentItem.file} />
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={goDone}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Mark as reviewed and stay"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done
          </button>
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Shortcuts overlay */}
      {showShortcuts && (
        <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}

// ─── Review Card ──────────────────────────────────────────────

function ReviewCard({ item }: { item: ReviewQueueItem }) {
  // Fetch fresh file data so reindex/edits are reflected without
  // refetching the entire review queue (which would shift position).
  const { data: freshFile } = useQuery({
    queryKey: ['file', item.file.id],
    queryFn: () => filesApi.get(item.file.id),
    initialData: item.file,
    staleTime: 10_000,
  });
  const file = freshFile ?? item.file;
  const category = getMimeCategory(file.mimeType);
  const hasPreview = category === 'image' || file.previews?.length > 0;
  const isVideo = category === 'video';

  // Compute reasons from fresh file data so they update reactively
  const reasons = useMemo(() => {
    const r: string[] = [];
    if (!file.title) r.push('Missing title');
    if (!file.description) r.push('Missing description');
    const manualTags = file.tags?.filter((t: any) => t.source === 'manual') ?? [];
    if (manualTags.length === 0) r.push('No tags');
    const meta = file.meta as { fields?: Record<string, unknown> } | null;
    const people = meta?.fields?.people;
    if (!Array.isArray(people) || people.length === 0) r.push('No people tagged');
    return r;
  }, [file.title, file.description, file.tags, file.meta]);
  const openViewer = useAppStore((s) => s.openViewer);
  const queryClient = useQueryClient();
  const [showRename, setShowRename] = useState(false);

  const reindexMutation = useMutation({
    mutationFn: () => filesApi.reindex(file.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', file.id] });
      toast.success('File reindexed');
    },
    onError: (err: Error) => toast.error(`Reindex failed: ${err.message}`),
  });

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Left: Large preview */}
      <div className="flex flex-1 flex-col bg-muted/20 overflow-hidden min-w-0">
        {/* Priority reasons chips */}
        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1 shrink-0">
            {reasons.map((reason, i) => (
              <span
                key={i}
                className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              >
                {reason}
              </span>
            ))}
          </div>
        )}

        {/* Preview */}
        <div className="flex flex-1 items-center justify-center overflow-hidden p-4 min-h-0">
          {hasPreview && !isVideo ? (
            <button
              onClick={() => openViewer(file.id, [file])}
              className="group relative cursor-pointer max-h-full max-w-full flex items-center justify-center"
            >
              <img
                src={getPreviewUrl(file.id, 'LARGE')}
                alt={(file.meta?.fields?.altText as string | undefined) ?? file.name}
                className="max-h-full max-w-full rounded-lg object-contain shadow-lg transition-shadow group-hover:shadow-xl"
                loading="eager"
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 group-hover:bg-black/10 transition-colors">
                <div className="rounded-full bg-black/50 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="h-4 w-4 text-white" />
                </div>
              </div>
            </button>
          ) : isVideo ? (
            <ReviewVideoPlayer file={file} onOpenViewer={() => openViewer(file.id, [file])} />
          ) : (
            <div className="flex h-48 w-72 flex-col items-center justify-center rounded-lg border border-border bg-muted">
              <FileIconLarge mimeType={file.mimeType} />
              <p className="mt-3 text-xs text-muted-foreground">{file.mimeType?.split('/')[1]?.toUpperCase() ?? 'File'}</p>
            </div>
          )}
        </div>

        {/* File name + size beneath preview */}
        <div className="mt-3 text-center">
          <p className="text-sm font-medium truncate max-w-md">
            {file.title ?? friendlyName(file.name)}
          </p>
          <div className="flex items-center justify-center gap-1 mt-0.5">
            <button
              onClick={() => setShowRename(true)}
              className="group flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title="Rename file"
            >
              <span className="truncate max-w-xs font-mono">{file.name}</span>
              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
            </button>
            {file.size > 0 && <span className="text-[11px] text-muted-foreground">&middot; {formatBytes(Number(file.size))}</span>}
          </div>
        </div>
      </div>

      {/* Right: Metadata editor panel */}
      <div className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-card p-4 space-y-4">
        {/* Actions row */}
        <div className="flex items-center gap-1.5">
          <FavoriteButton entityType="FILE" entityId={file.id} />
          <CollectionButton entityType="FILE" entityId={file.id} />
          <button
            onClick={() => setShowRename(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Rename file"
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => reindexMutation.mutate()}
            disabled={reindexMutation.isPending}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Re-index file"
            title="Re-index"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', reindexMutation.isPending && 'animate-spin')} />
          </button>
        </div>

        {/* File info compact */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs rounded-lg border border-border bg-muted/20 p-2.5">
          <InfoItem label="Size" value={formatBytes(Number(file.size))} />
          <InfoItem label="Type" value={file.mimeType?.split('/')[1]?.toUpperCase() ?? '—'} />
          {(() => {
            const w = file.meta?.fields?.width as number | undefined;
            const h = file.meta?.fields?.height as number | undefined;
            return w && h ? <InfoItem label="Dimensions" value={`${w}\u00D7${h}`} /> : null;
          })()}
          {(() => {
            const d = file.meta?.fields?.duration as number | undefined;
            if (d == null) return null;
            const m = Math.floor(d / 60);
            const s = Math.floor(d % 60);
            return <InfoItem label="Duration" value={`${m}:${s.toString().padStart(2, '0')}`} />;
          })()}
          {(() => {
            const f = file.meta?.fields ?? {};
            const camera = [f.cameraMake, f.cameraModel].filter(Boolean).join(' ');
            return camera ? <InfoItem label="Camera" value={camera as string} /> : null;
          })()}
          {!!file.meta?.fields?.lensModel && <InfoItem label="Lens" value={String(file.meta.fields.lensModel)} />}
          {file.meta?.fields?.iso != null && <InfoItem label="ISO" value={String(file.meta.fields.iso)} />}
          {file.meta?.fields?.aperture != null && <InfoItem label="Aperture" value={`f/${file.meta.fields.aperture}`} />}
          {!!file.meta?.fields?.shutterSpeed && <InfoItem label="Shutter" value={`${String(file.meta.fields.shutterSpeed)}s`} />}
          {file.meta?.fields?.focalLength != null && (
            <InfoItem label="Focal" value={`${file.meta.fields.focalLength}mm${file.meta.fields.focalLength35mm ? ` (${file.meta.fields.focalLength35mm}mm)` : ''}`} />
          )}
          {!!file.meta?.fields?.exposureProgram && <InfoItem label="Exposure" value={String(file.meta.fields.exposureProgram)} />}
          {!!file.meta?.fields?.whiteBalance && <InfoItem label="White Bal." value={String(file.meta.fields.whiteBalance)} />}
          {file.meta?.fields?.flash != null && <InfoItem label="Flash" value={file.meta.fields.flash ? 'Fired' : 'No flash'} />}
          {!!file.meta?.fields?.colorSpace && <InfoItem label="Color" value={String(file.meta.fields.colorSpace)} />}
          {!!file.meta?.fields?.software && <InfoItem label="Software" value={String(file.meta.fields.software)} />}
          {!!file.meta?.fields?.dateTaken && (
            <InfoItem label="Taken" value={new Date(String(file.meta.fields.dateTaken)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />
          )}
          {file.fileCreatedAt && (
            <InfoItem label="Created" value={new Date(file.fileCreatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />
          )}
          {file.fileModifiedAt && (
            <InfoItem label="Modified" value={new Date(file.fileModifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />
          )}
          {file.meta?.fields?.gpsLatitude != null && file.meta?.fields?.gpsLongitude != null && (
            <InfoItem label="Location" value={`${Number(file.meta.fields.gpsLatitude).toFixed(6)}, ${Number(file.meta.fields.gpsLongitude).toFixed(6)}`} />
          )}
          {file.meta?.fields?.gpsAltitude != null && (
            <InfoItem label="Altitude" value={`${Number(file.meta.fields.gpsAltitude).toFixed(0)}m`} />
          )}
        </div>

        {/* Metadata editor — reuses the existing component which handles
            title, description, caption, altText, tags, people, multiselect,
            custom fields, and AI suggestions */}
        <div className="border-t border-border pt-3">
          <FileMetadataEditor file={file} />
        </div>

        {/* AI Tags (read-only) */}
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
      </div>

      {/* Rename dialog */}
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
    </div>
  );
}

// ─── Review Video Player ──────────────────────────────────────

function ReviewVideoPlayer({ file, onOpenViewer }: { file: FileDto; onOpenViewer: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const queryClient = useQueryClient();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Check if Dropbox file is streamable
  const { data: cacheState, isLoading: cacheLoading } = useQuery({
    queryKey: ['file-cache', file.id],
    queryFn: () => filesApi.cacheStatus(file.id),
    staleTime: 30_000,
  });

  const isDropbox = cacheState?.providerType === 'DROPBOX';
  const isStreamable = !isDropbox || cacheState?.streamable === true;

  // Auto-download Dropbox files for streaming
  const [downloadElapsed, setDownloadElapsed] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const elapsedRef = useRef<number | null>(null);

  const downloadMutation = useMutation({
    mutationFn: async () => {
      setDownloadError(null);
      setDownloadElapsed(0);
      elapsedRef.current = window.setInterval(() => {
        setDownloadElapsed((s) => s + 1);
      }, 1000);
      try {
        return await filesApi.cacheOffline(file.id);
      } finally {
        if (elapsedRef.current) window.clearInterval(elapsedRef.current);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-cache', file.id] });
    },
    onError: (err: Error) => {
      setDownloadError(err.message || 'Download failed');
      setDownloadElapsed(0);
    },
  });

  // Auto-trigger download when we detect a non-streamable Dropbox file
  const autoTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (isDropbox && !isStreamable && !cacheLoading && !downloadMutation.isPending && autoTriggeredRef.current !== file.id) {
      autoTriggeredRef.current = file.id;
      downloadMutation.mutate();
    }
  }, [isDropbox, isStreamable, cacheLoading, file.id, downloadMutation]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Loading cache state
  if (cacheLoading) {
    return (
      <div className="flex h-64 w-96 items-center justify-center rounded-lg border border-border bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Non-streamable: show thumbnail + download progress
  if (!isStreamable || error) {
    const downloading = downloadMutation.isPending;

    return (
      <div className="relative max-h-full max-w-full flex items-center justify-center">
        {/* Thumbnail background */}
        {file.previews?.length > 0 ? (
          <img
            src={getPreviewUrl(file.id, 'LARGE')}
            alt={file.name}
            className="max-h-full max-w-full rounded-lg object-contain shadow-lg opacity-40"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center rounded-lg bg-gradient-to-b from-purple-500/10 to-purple-500/5 border border-border">
            <FileVideo className="h-16 w-16 text-purple-400/40" />
          </div>
        )}

        {/* Overlay with status */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg">
          {downloading ? (
            <div className="w-64 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">Downloading from Dropbox</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatBytes(Number(file.size))} &middot; {downloadElapsed}s elapsed
              </p>
              {/* Indeterminate progress bar */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            </div>
          ) : downloadError ? (
            <div className="w-64 text-center">
              <p className="text-sm font-medium text-destructive">Download failed</p>
              <p className="mt-1 text-xs text-muted-foreground">{downloadError}</p>
              <button
                onClick={() => downloadMutation.mutate()}
                className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </button>
            </div>
          ) : error ? (
            <div className="w-64 text-center">
              <FileVideo className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-2 text-sm text-muted-foreground">Cannot play this video</p>
              <button
                onClick={onOpenViewer}
                className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Open in viewer
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative max-h-full max-w-full flex items-center justify-center">
      <video
        ref={videoRef}
        key={file.id}
        src={`/api/files/${file.id}/stream`}
        muted={muted}
        playsInline
        preload="metadata"
        poster={file.previews?.length > 0 ? getPreviewUrl(file.id, 'LARGE') : undefined}
        className={cn(
          'max-h-full max-w-full rounded-lg shadow-lg cursor-pointer',
          !ready && 'opacity-50',
        )}
        onClick={togglePlay}
        onCanPlay={() => setReady(true)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError(true)}
      />

      {/* Play overlay when paused */}
      {!playing && ready && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-lg cursor-pointer"
          onClick={togglePlay}
        >
          <div className="rounded-full bg-black/50 p-4 backdrop-blur-sm">
            <Play className="h-8 w-8 text-white fill-white" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      {ready && (
        <div className="absolute inset-x-3 bottom-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 backdrop-blur-md ring-1 ring-white/10">
            {/* Play/pause */}
            <button onClick={togglePlay} className="text-white/80 hover:text-white">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-white" />}
            </button>

            {/* Progress bar */}
            <div
              className="flex-1 h-1 rounded-full bg-white/20 cursor-pointer relative"
              onClick={seek}
            >
              <div
                className="h-full rounded-full bg-white/80 transition-[width] duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Time */}
            <span className="text-[10px] text-white/60 tabular-nums shrink-0">
              {fmt(currentTime)} / {fmt(duration)}
            </span>

            {/* Mute */}
            <button onClick={() => setMuted((m) => !m)} className="text-white/80 hover:text-white">
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>

            {/* Fullscreen / lightbox */}
            <button onClick={onOpenViewer} className="text-white/80 hover:text-white" title="Open in viewer">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Supporting Components ────────────────────────────────────

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function FileIconLarge({ mimeType }: { mimeType: string | null }) {
  const category = getMimeCategory(mimeType);
  const cls = 'h-12 w-12 text-muted-foreground/30';
  switch (category) {
    case 'image': return <FileImage className={cls} />;
    case 'video': return <FileVideo className={cls} />;
    case 'audio': return <FileAudio className={cls} />;
    case 'document': return <FileText className={cls} />;
    default: return <File className={cls} />;
  }
}

function FolderContext({ file }: { file: FileDto }) {
  if (!file.folderId) return null;
  // Show the folder path from the file's path
  const parts = file.path.split('/');
  const folderPath = parts.slice(0, -1).join('/');
  if (!folderPath) return null;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <FolderOpen className="h-3 w-3" />
      <span className="truncate max-w-xs">{folderPath}</span>
    </div>
  );
}

function ReviewEmptyState({
  filters,
  onClearFilters,
}: {
  filters: string[];
  onClearFilters: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {filters.length > 0 ? 'No items match these filters' : 'All caught up!'}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {filters.length > 0
            ? 'Try adjusting your filters to see more items.'
            : 'Your archive is looking good. Check back later as new items are added.'}
        </p>
        {filters.length > 0 && (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <X className="h-4 w-4" />
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────

const FILTER_OPTIONS = [
  { key: 'missing_title', label: 'Missing Title', icon: FileText },
  { key: 'missing_tags', label: 'Missing Tags', icon: ClipboardCheck },
  { key: 'missing_people', label: 'Missing People', icon: ClipboardCheck },
  { key: 'unconfirmed_faces', label: 'Unconfirmed Faces', icon: ClipboardCheck },
  { key: 'images', label: 'Images Only', icon: FileImage },
  { key: 'videos', label: 'Videos Only', icon: FileVideo },
] as const;

function FilterBar({
  filters,
  rootFilter,
  folderFilter,
  roots,
  onToggleFilter,
  onSetRoot,
  onSetFolder,
}: {
  filters: string[];
  rootFilter: string;
  folderFilter: string;
  roots: Array<{ id: string; name: string }>;
  onToggleFilter: (f: string) => void;
  onSetRoot: (r: string) => void;
  onSetFolder: (f: string) => void;
}) {
  // Fetch folder tree when a root is selected
  const { data: folderTree } = useQuery({
    queryKey: ['folder-tree', rootFilter],
    queryFn: () => folders.tree(rootFilter),
    enabled: !!rootFilter,
    staleTime: 60_000,
  });

  // Flatten folder tree into a list with indentation for the dropdown
  const flatFolders = useMemo(() => {
    if (!folderTree) return [];
    const result: Array<{ id: string; name: string; depth: number; path: string }> = [];
    function walk(items: any[], depth: number) {
      for (const f of items) {
        result.push({ id: f.id, name: f.name, depth, path: f.path ?? '' });
        if (f.children?.length) walk(f.children, depth + 1);
      }
    }
    walk(folderTree, 0);
    return result;
  }, [folderTree]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 bg-muted/30">
      <span className="text-[11px] font-medium text-muted-foreground shrink-0">Filter:</span>

      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map(({ key, label }) => {
          const isOn = filters.includes(key);
          return (
            <button
              key={key}
              onClick={() => onToggleFilter(key)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium border transition-colors',
                isOn
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="h-4 w-px bg-border mx-1" />

      {/* Archive root selector */}
      <select
        value={rootFilter}
        onChange={(e) => {
          onSetRoot(e.target.value);
          onSetFolder(''); // Reset folder when root changes
        }}
        className="rounded-md border border-border bg-transparent px-2 py-0.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">All archives</option>
        {roots.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>

      {/* Folder selector — only shown when a root is selected */}
      {rootFilter && flatFolders.length > 0 && (
        <select
          value={folderFilter}
          onChange={(e) => onSetFolder(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-0.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[200px]"
        >
          <option value="">All folders</option>
          {flatFolders.map((f) => (
            <option key={f.id} value={f.id}>
              {'  '.repeat(f.depth)}{f.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── Shortcuts Overlay ────────────────────────────────────────

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5 text-sm">
          <ShortcutRow keys={['→']} label="Next" />
          <ShortcutRow keys={['←']} label="Previous" />
          <ShortcutRow keys={['D']} label="Done (mark reviewed)" />
          <ShortcutRow keys={['Tab']} label="Next field" />
          <ShortcutRow keys={['?']} label="Toggle shortcuts" />
          <ShortcutRow keys={['Esc']} label="Close overlays" />
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground/50 mx-0.5">/</span>}
            <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {k}
            </kbd>
          </span>
        ))}
      </div>
    </div>
  );
}
