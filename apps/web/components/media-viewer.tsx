'use client';

/**
 * MediaViewer — fresh rebuild
 * ───────────────────────────
 * This is a from-scratch implementation. No carry-over from prior
 * attempts. Design goals, in priority order:
 *
 *   1. Reliable keyboard navigation (←/→/Esc/Space) in real runtime —
 *      not just on paper. The viewer owns the keyboard while it is
 *      open and nothing else can intercept the keys it cares about.
 *   2. Working slideshow that actually auto-advances images and
 *      auto-advances on video onEnded.
 *   3. Visible native video controls that the user can click with the
 *      mouse, but that can NEVER hold keyboard focus.
 *   4. Single source of truth: the parent passes `file` and `files`,
 *      navigation goes back through `onNavigate`. Local state is only
 *      for things that are purely viewer-local (slideshow on/off,
 *      slideshow delay).
 *
 * Why the previous attempts kept failing:
 *
 *   • The native <video> element’s UA shadow-DOM keyboard handlers
 *     intercept ←/→/Space *before* React-style listeners get a chance
 *     to act on them, IF the video element holds focus. Autoplay +
 *     a single mouse click on the controls is enough to give the
 *     video focus, and from then on the viewer is dead to keyboard
 *     input.
 *   • Slideshow logic was correct in isolation but tied to effect
 *     dependency arrays that didn’t always re-arm cleanly.
 *
 * What this rebuild does differently:
 *
 *   • Registers ONE keydown listener on BOTH `window` and `document`
 *     in capture phase, with `stopImmediatePropagation` — belt and
 *     suspenders against any other listener anywhere on the page.
 *   • On every keydown, before doing anything else, force-blurs the
 *     active element if it’s a <video>. This means the very first
 *     keystroke after focus drifts to the video bounces focus back
 *     out, and the subsequent default action of the keystroke runs
 *     against a video that no longer holds focus.
 *   • <video> is `tabIndex={-1}` and self-blurs on focus.
 *   • The slideshow timer effect uses a minimal, explicit dep set
 *     and reads `goNext` from a stable ref so it can never miss a
 *     re-arm.
 *   • Pure decision logic lives in `@/lib/viewer-keyboard` and is
 *     covered by 29 vitest cases. The React shell here just wires
 *     real DOM events into those pure decisions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  FileVideo,
  Heart,
  LayoutList,
  Loader2,
  Pause,
  Plus,
  Timer,
  X,
} from 'lucide-react';

import { collections as collectionsApi, favorites as favoritesApi, getPreviewUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  decideKeyAction,
  shouldAdvanceOnVideoEnd,
  shouldArmSlideshowTimer,
} from '@/lib/viewer-keyboard';
import { trackView } from '@/components/dashboard';
import { getMimeCategory } from '@harbor/utils';
import type { FileDto } from '@harbor/types';

const STREAM_BASE = '/api';
const DEFAULT_DELAY_SECONDS = 3;

interface MediaViewerProps {
  file: FileDto;
  files: FileDto[];
  onClose: () => void;
  onNavigate: (fileId: string) => void;
}

export function MediaViewer({ file, files, onClose, onNavigate }: MediaViewerProps) {
  // ── Derived navigation state ─────────────────────────────────────
  const rawIdx = files.findIndex((f) => f.id === file.id);
  const idx = rawIdx >= 0 ? rawIdx : 0;
  const total = files.length;
  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;
  const category = getMimeCategory(file.mimeType);

  // ── Viewer-local state ───────────────────────────────────────────
  const [slideshow, setSlideshow] = useState(false);
  const [delaySec, setDelaySec] = useState(DEFAULT_DELAY_SECONDS);

  // Track view for the recently-viewed dashboard
  useEffect(() => {
    trackView(file.id);
  }, [file.id]);

  // ── Stable ref over the latest values the listener needs ─────────
  // The keydown listener is registered ONCE. Everything mutable lives
  // here so the listener can read the latest values without ever
  // having to be torn down and re-registered.
  const liveRef = useRef({ idx, hasPrev, hasNext, files, slideshow, onNavigate, onClose });
  liveRef.current = { idx, hasPrev, hasNext, files, slideshow, onNavigate, onClose };

  // ── Stable actions ───────────────────────────────────────────────
  const goNext = useCallback(() => {
    const s = liveRef.current;
    if (s.hasNext) s.onNavigate(s.files[s.idx + 1].id);
  }, []);

  const goPrev = useCallback(() => {
    const s = liveRef.current;
    if (s.hasPrev) s.onNavigate(s.files[s.idx - 1].id);
  }, []);

  const closeViewer = useCallback(() => {
    setSlideshow(false);
    liveRef.current.onClose();
  }, []);

  const toggleSlideshow = useCallback(() => {
    setSlideshow((v) => !v);
  }, []);

  // ── Keyboard ownership ───────────────────────────────────────────
  // Listener is registered on BOTH window and document in capture
  // phase. Either one will fire first depending on browser; whichever
  // does will stopImmediatePropagation and the other becomes a no-op.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      // STEP 1 — defensively eject focus from any <video> element so
      // the UA shadow-DOM controls cannot act on this same keystroke.
      const active = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
      if (active && active.tagName === 'VIDEO') {
        try {
          active.blur();
        } catch {
          /* no-op */
        }
      }

      // STEP 2 — let the pure controller decide what to do.
      const action = decideKeyAction(
        { key: event.key, target: event.target },
        { hasPrev: liveRef.current.hasPrev, hasNext: liveRef.current.hasNext },
      );
      if (action.type === 'ignore') return;

      // STEP 3 — claim the event so nothing else handles it.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // STEP 4 — dispatch.
      switch (action.type) {
        case 'next':
          goNext();
          break;
        case 'prev':
          goPrev();
          break;
        case 'close':
          closeViewer();
          break;
        case 'toggle-slideshow':
          toggleSlideshow();
          break;
      }
    }

    window.addEventListener('keydown', handleKey, { capture: true });
    document.addEventListener('keydown', handleKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKey, { capture: true });
      document.removeEventListener('keydown', handleKey, { capture: true });
    };
  }, [goNext, goPrev, closeViewer, toggleSlideshow]);

  // ── Slideshow timer (images only) ────────────────────────────────
  // Re-arms whenever the current image, slideshow flag, or delay
  // changes. Videos are handled separately via onEnded.
  useEffect(() => {
    if (!shouldArmSlideshowTimer({ slideshow, category, hasNext })) {
      return;
    }
    const id = window.setTimeout(() => {
      goNext();
    }, delaySec * 1000);
    return () => window.clearTimeout(id);
  }, [slideshow, category, hasNext, delaySec, file.id, goNext]);

  // Stop slideshow if it would otherwise spin at end-of-list on an image
  useEffect(() => {
    if (slideshow && !hasNext && category === 'image') {
      setSlideshow(false);
    }
  }, [slideshow, hasNext, category]);

  // ── Video ended → advance if slideshow is active ─────────────────
  const handleVideoEnded = useCallback(() => {
    const s = liveRef.current;
    if (shouldAdvanceOnVideoEnd({ slideshow: s.slideshow, hasNext: s.hasNext })) {
      goNext();
    }
  }, [goNext]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      data-testid="media-viewer"
      data-viewer-current-id={file.id}
      data-viewer-index={idx}
      data-viewer-total={total}
      data-viewer-slideshow={slideshow ? 'on' : 'off'}
      data-viewer-category={category}
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${file.title ?? file.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm animate-fade-in outline-none"
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{file.title ?? file.name}</p>
          <p className="text-xs text-white/40">
            {idx + 1} / {total}
            {(file.meta?.fields?.duration as number | undefined) != null && ` · ${formatDuration(file.meta!.fields!.duration as number)}`}
            {file.mimeType && ` · ${file.mimeType.split('/')[1]?.toUpperCase()}`}
          </p>
        </div>

        {/* Slideshow */}
        <div className="flex items-center gap-1">
          <button
            data-testid="viewer-slideshow-toggle"
            onClick={toggleSlideshow}
            className={cn(
              'rounded-md p-2 transition-colors',
              slideshow ? 'text-primary bg-primary/20' : 'text-white/50 hover:bg-white/10 hover:text-white',
            )}
            title={slideshow ? 'Pause slideshow' : 'Start slideshow (Space)'}
            aria-pressed={slideshow}
          >
            {slideshow ? <Pause className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
          </button>
          {slideshow && (
            <select
              value={delaySec}
              onChange={(e) => setDelaySec(Number(e.target.value))}
              className="h-7 rounded bg-white/10 px-1 text-[10px] text-white/70 border-0"
              aria-label="Slideshow delay"
            >
              <option value={2}>2s</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
          )}
        </div>

        <ViewerActions fileId={file.id} />

        <button
          data-testid="viewer-close"
          onClick={closeViewer}
          className="rounded-md p-2 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Close viewer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {hasPrev && (
          <button
            data-testid="viewer-prev"
            onClick={goPrev}
            aria-label="Previous"
            className="absolute left-3 z-10 rounded-full bg-black/50 p-2.5 text-white/50 hover:bg-black/70 hover:text-white transition-all"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <div className="flex h-full w-full items-center justify-center px-14 py-4">
          {category === 'image' ? (
            <ImageStage file={file} />
          ) : category === 'video' ? (
            <VideoStage file={file} onEnded={handleVideoEnded} />
          ) : (
            <NotViewable />
          )}
        </div>

        {hasNext && (
          <button
            data-testid="viewer-next"
            onClick={goNext}
            aria-label="Next"
            className="absolute right-3 z-10 rounded-full bg-black/50 p-2.5 text-white/50 hover:bg-black/70 hover:text-white transition-all"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {slideshow && category === 'image' && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10" aria-hidden="true">
            <div
              key={file.id}
              className="h-full bg-primary animate-[grow-width_var(--dur)_linear]"
              style={{ ['--dur' as string]: `${delaySec}s` } as React.CSSProperties}
            />
          </div>
        )}
      </div>

      {/* Footer hint bar */}
      <div className="flex items-center justify-center gap-5 pb-2 text-[10px] text-white/25">
        <KeyHint label="Prev" k="←" />
        <KeyHint label="Next" k="→" />
        <KeyHint label="Close" k="Esc" />
        <KeyHint label="Slideshow" k="Space" />
      </div>
    </div>
  );
}

// ─── Small UI primitives ──────────────────────────────────────────

function KeyHint({ label, k }: { label: string; k: string }) {
  return (
    <span>
      <kbd className="rounded border border-white/15 px-1 py-0.5">{k}</kbd> {label}
    </span>
  );
}

function NotViewable() {
  return (
    <div className="text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-white/15" />
      <p className="mt-3 text-sm text-white/40">Not viewable</p>
    </div>
  );
}

// ─── Image stage ──────────────────────────────────────────────────

function ImageStage({ file }: { file: FileDto }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [file.id]);

  if (errored) {
    return (
      <div className="text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-white/15" />
        <p className="mt-3 text-sm text-white/40">Failed to load</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {!loaded && <Loader2 className="h-8 w-8 animate-spin text-white/20" />}
      <img
        key={file.id}
        src={getPreviewUrl(file.id, 'LARGE')}
        alt={file.name}
        className={cn(
          'max-h-full max-w-full object-contain select-none transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        draggable={false}
      />
    </div>
  );
}

// ─── Video stage ──────────────────────────────────────────────────

function VideoStage({ file, onEnded }: { file: FileDto; onEnded: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setState('loading');
  }, [file.id]);

  if (file.size === 0) {
    return (
      <div className="text-center">
        <CloudOff className="mx-auto h-12 w-12 text-amber-400/40" />
        <p className="mt-3 text-sm text-white/40">Not available offline</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="text-center">
        <FileVideo className="mx-auto h-12 w-12 text-white/15" />
        <p className="mt-3 text-sm text-white/40">Cannot play</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {state === 'loading' && <Loader2 className="absolute h-8 w-8 animate-spin text-white/20" />}
      <video
        ref={videoRef}
        key={file.id}
        src={`${STREAM_BASE}/files/${file.id}/stream`}
        controls
        autoPlay
        playsInline
        // The video must NEVER hold keyboard focus. tabIndex=-1 keeps
        // it out of the Tab order; onFocus immediately blurs it for
        // mouse-driven focus (clicking the controls).
        tabIndex={-1}
        onFocus={(e) => e.currentTarget.blur()}
        className={cn('max-h-full max-w-full rounded-lg', state === 'loading' && 'opacity-0')}
        onCanPlay={() => setState('ready')}
        onError={() => setState('error')}
        onEnded={onEnded}
        poster={file.previews && file.previews.length > 0 ? getPreviewUrl(file.id, 'LARGE') : undefined}
      />
    </div>
  );
}

// ─── Side actions (favorite, add to collection) ───────────────────

function ViewerActions({ fileId }: { fileId: string }) {
  const qc = useQueryClient();
  const [showColl, setShowColl] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');

  const { data: favs } = useQuery({ queryKey: ['favorites'], queryFn: favoritesApi.list });
  const { data: colls } = useQuery({ queryKey: ['collections'], queryFn: collectionsApi.list });
  const isFav = favs?.some((f) => f.entityType === 'FILE' && f.entityId === fileId) ?? false;

  const favMut = useMutation({
    mutationFn: () => favoritesApi.toggle('FILE', fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });
  const addMut = useMutation({
    mutationFn: (id: string) => collectionsApi.addItem(id, 'FILE', fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      setShowColl(false);
    },
  });
  const newMut = useMutation({
    mutationFn: async () => {
      const c = await collectionsApi.create(newName);
      await collectionsApi.addItem(c.id, 'FILE', fileId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      setShowNew(false);
      setNewName('');
      setShowColl(false);
    },
  });

  return (
    <div className="flex items-center gap-0.5 relative">
      <button
        onClick={() => favMut.mutate()}
        className={cn('rounded-md p-2', isFav ? 'text-red-400' : 'text-white/50 hover:bg-white/10 hover:text-white')}
        aria-pressed={isFav}
        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart className={cn('h-4 w-4', isFav && 'fill-current')} />
      </button>
      <div className="relative">
        <button
          onClick={() => setShowColl(!showColl)}
          className="rounded-md p-2 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Add to collection"
        >
          <LayoutList className="h-4 w-4" />
        </button>
        {showColl && (
          <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-white/10 bg-neutral-900 p-1 shadow-xl z-20">
            {colls?.map((c) => (
              <button
                key={c.id}
                onClick={() => addMut.mutate(c.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-white/60 hover:bg-white/10"
              >
                <LayoutList className="h-3 w-3" />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            <div className="border-t border-white/10 mt-1 pt-1">
              {showNew ? (
                <div className="flex gap-1 px-1">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name"
                    autoFocus
                    className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white border-0 focus:outline-none"
                    onKeyDown={(e) => {
                      // Prevent the viewer's window-capture handler from
                      // hijacking Space or Escape while the user types
                      // a collection name.
                      e.nativeEvent.stopImmediatePropagation();
                      if (e.key === 'Enter' && newName.trim()) newMut.mutate();
                      if (e.key === 'Escape') setShowNew(false);
                    }}
                  />
                  <button
                    onClick={() => newName.trim() && newMut.mutate()}
                    className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNew(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-white/40 hover:bg-white/10"
                >
                  <Plus className="h-3 w-3" /> New
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
