'use client';

/**
 * Lightbox — Harbor's full-screen media viewer.
 *
 * Features in this revision:
 *
 *   • Sleek slide transitions between items via framer-motion's
 *     AnimatePresence — direction tracked so left/right feel natural.
 *   • Theater mode toggle (T or button) — chrome fades away and the
 *     media takes the entire viewport while preserving aspect ratio.
 *   • Custom video player (no UA controls so the shadow-DOM keyboard
 *     handlers can never intercept ←/→/Space).
 *     - Draggable seek bar (mousedown→window mousemove/up).
 *     - Click-to-seek as well as drag.
 *     - Always-visible playback progress strip pinned to the very
 *       top edge of the viewer chrome — visible at a glance without
 *       hovering the video.
 *   • Global mute persistence via the app store + StoreHydrator.
 *     Default state is muted. Once a user unmutes, every subsequent
 *     video opens unmuted until they mute again. M toggles mute.
 *   • Slideshow timer for images, onEnded auto-advance for videos.
 *
 * Keyboard ownership: a single capture-phase keydown listener on
 * BOTH window and document. Whichever fires first claims the event
 * via stopImmediatePropagation; the other becomes a no-op.
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileVideo,
  FolderPlus,
  Globe,
  Heart,
  Loader2,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  Timer,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/cn';
import { collections as collectionsApi, favorites as favoritesApi, getPreviewUrl } from '@/lib/api';
import { trackView } from '@/lib/recently-viewed';
import { useAppStore } from '@/lib/store';
import { DropboxOfflinePlaceholder, useDropboxCacheState } from '@/components/dropbox-offline';
import { getMimeCategory } from '@harbor/utils';
import type { FileDto } from '@harbor/types';
import {
  initialLightboxState,
  keyToAction,
  lightboxReducer,
  shouldAdvanceOnVideoEnd,
  shouldArmImageTimer,
  shouldAutoStopSlideshow,
} from '@/lib/lightbox-machine';

const STREAM_BASE = '/api';

interface LightboxProps {
  file: FileDto;
  files: FileDto[];
  onClose: () => void;
  onNavigate: (fileId: string) => void;
}

export function Lightbox({ file, files, onClose, onNavigate }: LightboxProps) {
  // ── Derived navigation state ─────────────────────────────────────
  const rawIdx = files.findIndex((f) => f.id === file.id);
  const idx = rawIdx >= 0 ? rawIdx : 0;
  const total = files.length;
  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;
  const category = getMimeCategory(file.mimeType);

  // ── Reducer-driven viewer state ──────────────────────────────────
  const [state, dispatch] = useReducer(lightboxReducer, initialLightboxState);

  // ── Global preferences from the store ────────────────────────────
  const videoMuted = useAppStore((s) => s.videoMuted);
  const setVideoMuted = useAppStore((s) => s.setVideoMuted);
  const theaterMode = useAppStore((s) => s.theaterMode);
  const toggleTheaterMode = useAppStore((s) => s.toggleTheaterMode);

  // ── Slide direction (for transition animation) ───────────────────
  // Updated by the navigation actions BEFORE state changes so the
  // outgoing/incoming AnimatePresence pair knows which way to slide.
  const [direction, setDirection] = useState<1 | -1>(1);
  const lastIdxRef = useRef(idx);
  useEffect(() => {
    if (idx > lastIdxRef.current) setDirection(1);
    else if (idx < lastIdxRef.current) setDirection(-1);
    lastIdxRef.current = idx;
  }, [idx]);

  // ── Track view ───────────────────────────────────────────────────
  useEffect(() => { trackView(file.id); }, [file.id]);

  // ── Live ref over everything the long-lived listeners need ──────
  const live = useRef({
    idx, hasPrev, hasNext, files,
    slideshowOn: state.slideshowOn,
    onNavigate, onClose,
  });
  live.current = {
    idx, hasPrev, hasNext, files,
    slideshowOn: state.slideshowOn,
    onNavigate, onClose,
  };

  // ── Stable actions ───────────────────────────────────────────────
  const goNext = useCallback(() => {
    const c = live.current;
    if (c.hasNext) {
      setDirection(1);
      c.onNavigate(c.files[c.idx + 1].id);
    }
  }, []);

  const goPrev = useCallback(() => {
    const c = live.current;
    if (c.hasPrev) {
      setDirection(-1);
      c.onNavigate(c.files[c.idx - 1].id);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    dispatch({ type: 'SET_SLIDESHOW', on: false });
    live.current.onClose();
  }, []);

  const toggleSlideshow = useCallback(() => {
    dispatch({ type: 'TOGGLE_SLIDESHOW' });
  }, []);

  const toggleMute = useCallback(() => {
    setVideoMuted(!useAppStore.getState().videoMuted);
  }, [setVideoMuted]);

  // ── Keyboard ownership ───────────────────────────────────────────
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      // Defensive: kick a focused <video> out so the UA shadow-DOM
      // controls cannot react to this same keystroke.
      if (typeof document !== 'undefined') {
        const active = document.activeElement as HTMLElement | null;
        if (active && active.tagName === 'VIDEO') {
          try { active.blur(); } catch { /* no-op */ }
        }
      }

      const action = keyToAction(event.key, event.target);
      if (action === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      switch (action) {
        case 'next': goNext(); break;
        case 'prev': goPrev(); break;
        case 'close': closeLightbox(); break;
        case 'toggle-slideshow': toggleSlideshow(); break;
        case 'toggle-theater': toggleTheaterMode(); break;
        case 'toggle-mute': toggleMute(); break;
      }
    }

    window.addEventListener('keydown', handleKey, { capture: true });
    document.addEventListener('keydown', handleKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKey, { capture: true });
      document.removeEventListener('keydown', handleKey, { capture: true });
    };
  }, [goNext, goPrev, closeLightbox, toggleSlideshow, toggleTheaterMode, toggleMute]);

  // ── Slideshow timer (images) ─────────────────────────────────────
  useEffect(() => {
    if (!shouldArmImageTimer({ slideshowOn: state.slideshowOn, category, hasNext })) return;
    const id = window.setTimeout(() => goNext(), state.delaySec * 1000);
    return () => window.clearTimeout(id);
  }, [state.slideshowOn, state.delaySec, category, hasNext, file.id, goNext]);

  // ── Auto-stop slideshow at end of list (image only) ──────────────
  useEffect(() => {
    if (shouldAutoStopSlideshow({ slideshowOn: state.slideshowOn, hasNext, category })) {
      dispatch({ type: 'SET_SLIDESHOW', on: false });
    }
  }, [state.slideshowOn, hasNext, category]);

  // ── Video progress (current playback fraction for top-edge bar) ──
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  useEffect(() => {
    setVideoProgress(0);
    setVideoDuration(0);
  }, [file.id]);

  // ── Video onEnded → advance ──────────────────────────────────────
  const handleVideoEnded = useCallback(() => {
    if (shouldAdvanceOnVideoEnd({ slideshowOn: live.current.slideshowOn, hasNext: live.current.hasNext })) {
      goNext();
    }
  }, [goNext]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${file.title ?? file.name}`}
      data-testid="lightbox"
      data-lightbox-current-id={file.id}
      data-lightbox-index={idx}
      data-lightbox-total={total}
      data-lightbox-slideshow={state.slideshowOn ? 'on' : 'off'}
      data-lightbox-theater={theaterMode ? 'on' : 'off'}
      data-lightbox-category={category}
      tabIndex={-1}
      className={cn(
        'fixed inset-0 z-50 outline-none',
        // Theater mode darkens further and pushes the media to fill
        // every available pixel.
        theaterMode ? 'bg-black' : '',
      )}
    >
      {/* Backdrop — dynamic per-item blurred wash. */}
      <DynamicBackdrop file={file} category={category} theaterMode={theaterMode} />

      {/* Top-edge always-visible video progress bar */}
      {category === 'video' && videoDuration > 0 && (
        <div className="absolute inset-x-0 top-0 z-30 h-[3px] bg-white/10" aria-hidden="true">
          <div
            className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-[width] duration-100"
            style={{ width: `${(videoProgress / videoDuration) * 100}%` }}
          />
        </div>
      )}

      {/* Top-left title pill — hidden in theater mode */}
      {!theaterMode && (
        <div className="pointer-events-none absolute left-6 top-6 z-10 flex max-w-md">
          <div className="pointer-events-auto rounded-full bg-white/[0.04] px-4 py-2 backdrop-blur-xl ring-1 ring-white/10">
            <p className="truncate text-xs font-medium text-white/80">{file.title ?? file.name}</p>
          </div>
        </div>
      )}

      {/* Top-right counter + theater + close */}
      <div className="pointer-events-none absolute right-6 top-6 z-10 flex">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/[0.04] py-2 pl-4 pr-2 backdrop-blur-xl ring-1 ring-white/10">
          {!theaterMode && (
            <>
              <span className="font-mono text-[11px] tabular-nums text-white/60">
                {String(idx + 1).padStart(2, '0')}
                <span className="mx-1 text-white/25">/</span>
                {String(total).padStart(2, '0')}
              </span>
              <span className="h-4 w-px bg-white/15" aria-hidden="true" />
            </>
          )}
          <button
            type="button"
            data-testid="lightbox-theater-toggle"
            onClick={toggleTheaterMode}
            aria-pressed={theaterMode}
            aria-label="Toggle theater mode"
            title={`${theaterMode ? 'Exit' : 'Enter'} theater mode (T)`}
            className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            {theaterMode ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button
            type="button"
            data-testid="lightbox-close"
            onClick={closeLightbox}
            aria-label="Close viewer"
            className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage with slide transition */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          theaterMode ? 'p-0' : 'px-24 pb-32 pt-24',
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={file.id}
            initial={{ x: direction === 1 ? '8%' : '-8%', opacity: 0, scale: 0.98 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: direction === 1 ? '-8%' : '8%', opacity: 0, scale: 0.98 }}
            transition={{
              x: { type: 'spring', stiffness: 260, damping: 32, mass: 0.8 },
              opacity: { duration: 0.18, ease: 'easeOut' },
              scale: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
            }}
            className="flex h-full w-full items-center justify-center"
          >
            {category === 'image' && <ImageStage file={file} theaterMode={theaterMode} />}
            {category === 'video' && (
              <VideoStage
                file={file}
                muted={videoMuted}
                onMutedChange={setVideoMuted}
                onEnded={handleVideoEnded}
                onProgress={setVideoProgress}
                onDuration={setVideoDuration}
                theaterMode={theaterMode}
              />
            )}
            {category !== 'image' && category !== 'video' && <NotViewable />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Side nav buttons — hidden in theater mode */}
      {!theaterMode && hasPrev && (
        <button
          type="button"
          data-testid="lightbox-prev"
          onClick={goPrev}
          aria-label="Previous"
          className="absolute left-6 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/[0.04] text-white/60 ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {!theaterMode && hasNext && (
        <button
          type="button"
          data-testid="lightbox-next"
          onClick={goNext}
          aria-label="Next"
          className="absolute right-6 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/[0.04] text-white/60 ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-white/10 hover:text-white"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Bottom control bar — hidden in theater mode */}
      {!theaterMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/[0.04] p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
            <button
              type="button"
              data-testid="lightbox-slideshow-toggle"
              onClick={toggleSlideshow}
              aria-pressed={state.slideshowOn}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition',
                state.slideshowOn
                  ? 'bg-white text-neutral-950 hover:bg-white/90'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              {state.slideshowOn ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              {state.slideshowOn ? 'Pause' : 'Slideshow'}
            </button>

            {state.slideshowOn && (
              <div className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/60">
                <Timer className="h-3 w-3" aria-hidden="true" />
                <select
                  value={state.delaySec}
                  onChange={(e) => dispatch({ type: 'SET_DELAY', sec: Number(e.target.value) })}
                  aria-label="Slideshow delay"
                  className="cursor-pointer border-0 bg-transparent text-[11px] text-white/80 focus:outline-none"
                >
                  {[2, 3, 5, 10].map((s) => (
                    <option key={s} value={s} className="bg-neutral-900">{s}s</option>
                  ))}
                </select>
              </div>
            )}

            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />

            <FavoriteButton fileId={file.id} />
            <CollectionButton fileId={file.id} />
          </div>
        </div>
      )}

      {/* Slideshow progress strip (images only, bottom edge) */}
      {state.slideshowOn && category === 'image' && hasNext && (
        <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/10" aria-hidden="true">
          <motion.div
            key={file.id}
            className="h-full bg-white"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: state.delaySec, ease: 'linear' }}
          />
        </div>
      )}

      {/* Tiny keyboard hint, bottom-right (hidden in theater mode) */}
      {!theaterMode && (
        <div className="pointer-events-none absolute bottom-7 right-6 z-10 hidden gap-3 text-[10px] text-white/30 lg:flex">
          <KeyHint k="←" label="Prev" />
          <KeyHint k="→" label="Next" />
          <KeyHint k="Space" label="Slideshow" />
          <KeyHint k="T" label="Theater" />
          <KeyHint k="M" label="Mute" />
          <KeyHint k="Esc" label="Close" />
        </div>
      )}
    </div>
  );
}

// ─── Dynamic backdrop ─────────────────────────────────────────────

/**
 * A per-item ambient backdrop. We render a heavily blurred, scaled-up
 * copy of the current preview (image OR video poster) underneath a
 * dark vignette. The effect is similar to the Apple Photos / iOS
 * Music "now playing" wash: the chrome stays calm and dark while the
 * background subtly takes on the dominant tones of whatever the user
 * is looking at, and updates with a smooth crossfade as they
 * navigate.
 *
 * Falls back to a flat near-black gradient for items that don't have
 * a previewable surface (audio, archive files, etc.) and in theater
 * mode (where we want the chrome out of the way and the focus
 * entirely on the media).
 */
function DynamicBackdrop({
  file,
  category,
  theaterMode,
}: {
  file: FileDto;
  category: string | null;
  theaterMode: boolean;
}) {
  const hasPreview =
    (category === 'image' || category === 'video') && (file.previews?.length ?? 0) > 0;

  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-950" aria-hidden="true">
      {hasPreview && (
        <AnimatePresence initial={false} mode="popLayout">
          <motion.img
            key={file.id}
            src={getPreviewUrl(file.id, 'MEDIUM')}
            alt=""
            initial={{ opacity: 0, scale: 1.18 }}
            animate={{ opacity: theaterMode ? 0.35 : 0.55, scale: 1.25 }}
            exit={{ opacity: 0, scale: 1.18 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={{
              filter: 'blur(64px) saturate(1.4)',
              // Keep the blur edges off-screen so the user never sees a
              // sharp seam where the blurred image stops.
              transform: 'scale(1.25)',
              transformOrigin: 'center',
            }}
            draggable={false}
          />
        </AnimatePresence>
      )}

      {/* Dark wash on top of the blurred image so the controls and
          captions stay legible regardless of what the source looks
          like. Theater mode darkens further. */}
      <div
        className={cn(
          'absolute inset-0 backdrop-blur-2xl',
          theaterMode ? 'bg-black/90' : 'bg-neutral-950/70',
        )}
      />

      {/* Vignette only outside theater mode — keeps focus pinned on
          the media in the center while still showing some ambient
          color in the corners. */}
      {!theaterMode && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />
      )}
    </div>
  );
}

// ─── UI primitives ────────────────────────────────────────────────

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-white/15 px-1 py-0.5 font-mono text-[9px] text-white/50">{k}</kbd>
      <span>{label}</span>
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

function ImageStage({ file, theaterMode }: { file: FileDto; theaterMode: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setLoaded(false); setErrored(false); }, [file.id]);

  // Smart Dropbox gating. The cache-state query tells us whether
  // the bytes are reachable RIGHT NOW. We have three cases:
  //
  //   1. Loading        — show a small spinner only.
  //   2. Streamable     — render the real <img>.
  //   3. Not streamable — render the offline placeholder with the
  //                       "Make available offline" CTA.
  //
  // Crucially, we do NOT mount the <img> until we know the answer
  // for Dropbox files, otherwise the browser fires a request to
  // /preview that returns 404 and the loader hangs forever.
  const cacheState = useDropboxCacheState(file.id);
  if (cacheState.isLoading || !cacheState.data) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white/20" />
      </div>
    );
  }
  if (cacheState.data.providerType === 'DROPBOX' && cacheState.data.streamable !== true) {
    return <DropboxOfflinePlaceholder fileId={file.id} variant="lightbox" />;
  }

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
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          'select-none object-contain transition-opacity duration-200',
          // Theater mode lets the image take ALL the viewport.
          theaterMode ? 'h-screen max-h-screen w-screen max-w-[100vw]' : 'max-h-full max-w-full',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}

// ─── Video stage with custom controls ─────────────────────────────

function VideoStage({
  file,
  muted,
  onMutedChange,
  onEnded,
  onProgress,
  onDuration,
  theaterMode,
}: {
  file: FileDto;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onEnded: () => void;
  onProgress: (currentTime: number) => void;
  onDuration: (duration: number) => void;
  theaterMode: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setLoadState('loading');
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [file.id]);

  // Sync the persisted mute preference into the actual video element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
  }, [muted, loadState]);

  // Try to play. If autoplay is blocked even when muted, give up
  // gracefully — the user can click play.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    (async () => {
      try {
        video.muted = muted;
        await video.play();
        if (!cancelled) setPlaying(true);
      } catch {
        if (cancelled) return;
        // Try again with mute forced on (autoplay-with-sound blocked)
        try {
          video.muted = true;
          if (!cancelled) onMutedChange(true);
          await video.play();
          if (!cancelled) setPlaying(true);
        } catch { /* user must click play */ }
      }
    })();
    return () => { cancelled = true; };
    // We intentionally do NOT depend on `muted`/`onMutedChange` here:
    // they're already wired through the muted-sync effect above, and
    // including them would re-run the play() attempt every time the
    // user toggles mute, restarting playback.
  }, [loadState, file.id]);

  // Smart Dropbox gating — same logic as the image stage. We do
  // NOT mount the <video> element until the cache state confirms
  // it's streamable, because mounting it would fire a /stream
  // request that 404s for non-cached Dropbox files and leaves the
  // browser sitting on its native loader forever.
  const cacheState = useDropboxCacheState(file.id);
  if (cacheState.isLoading || !cacheState.data) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white/20" />
      </div>
    );
  }
  if (cacheState.data.providerType === 'DROPBOX' && cacheState.data.streamable !== true) {
    return (
      <DropboxOfflinePlaceholder
        fileId={file.id}
        variant="lightbox"
      />
    );
  }

  if (loadState === 'error') {
    return (
      <div className="text-center">
        <FileVideo className="mx-auto h-12 w-12 text-white/15" />
        <p className="mt-3 text-sm text-white/40">Cannot play</p>
      </div>
    );
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function toggleMute() {
    onMutedChange(!muted);
  }

  function seekTo(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration || v.duration || 0, seconds));
    v.currentTime = clamped;
    setCurrentTime(clamped);
    onProgress(clamped);
  }

  return (
    <div className="group relative flex h-full w-full items-center justify-center">
      {loadState === 'loading' && (
        <Loader2 className="absolute h-8 w-8 animate-spin text-white/20" />
      )}
      <video
        ref={videoRef}
        key={file.id}
        src={`${STREAM_BASE}/files/${file.id}/stream`}
        controls={false}
        playsInline
        tabIndex={-1}
        onFocus={(e) => e.currentTarget.blur()}
        onClick={togglePlay}
        className={cn(
          'cursor-pointer rounded-lg',
          theaterMode
            ? 'h-screen max-h-screen w-screen max-w-[100vw] rounded-none'
            : 'max-h-[78vh] max-w-full',
          loadState !== 'ready' && 'opacity-0',
        )}
        onCanPlay={() => setLoadState('ready')}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration || 0;
          setDuration(d);
          onDuration(d);
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime || 0;
          setCurrentTime(t);
          onProgress(t);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setLoadState('error')}
        onEnded={onEnded}
        poster={file.previews && file.previews.length > 0 ? getPreviewUrl(file.id, 'LARGE') : undefined}
      />

      {/* Custom video controls — visible on hover */}
      {loadState === 'ready' && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/70 px-4 py-2 backdrop-blur-md ring-1 ring-white/10">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className="text-white/90 hover:text-white"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <span className="font-mono text-[10px] tabular-nums text-white/70">
              {formatTime(currentTime)}
              <span className="mx-1 text-white/30">/</span>
              {formatTime(duration)}
            </span>
            <SeekBar
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
              onScrubStart={() => videoRef.current?.pause()}
              onScrubEnd={() => { if (playing) void videoRef.current?.play(); }}
            />
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="text-white/90 hover:text-white"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Draggable seek bar.
 *
 * Click anywhere → seek to that point.
 * Mousedown → start dragging; subsequent window mousemove updates the
 * playhead live until mouseup ends the drag. window-level listeners
 * are used (not div-level) so dragging works even when the cursor
 * leaves the bar.
 */
function SeekBar({
  currentTime,
  duration,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const fraction = dragFraction !== null
    ? dragFraction
    : duration > 0 ? currentTime / duration : 0;

  function fractionFromEvent(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    e.preventDefault();
    onScrubStart();
    const f = fractionFromEvent(e.clientX);
    setDragFraction(f);

    function onMove(ev: MouseEvent) {
      setDragFraction(fractionFromEvent(ev.clientX));
    }
    function onUp(ev: MouseEvent) {
      const finalF = fractionFromEvent(ev.clientX);
      onSeek(finalF * duration);
      setDragFraction(null);
      onScrubEnd();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration || 0}
      aria-valuenow={duration > 0 ? fraction * duration : 0}
      aria-label="Seek"
      onMouseDown={handleMouseDown}
      className="group/seek relative h-4 min-w-[12rem] flex-1 cursor-pointer rounded-full"
    >
      {/* Track background */}
      <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15" />
      {/* Filled portion */}
      <div
        className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
      {/* Drag handle — always visible so the user knows where they can grab */}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md ring-2 ring-white/30 transition-transform group-hover/seek:scale-125"
        style={{ left: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Favorite + collection mini-buttons ───────────────────────────

function FavoriteButton({ fileId }: { fileId: string }) {
  const qc = useQueryClient();
  const { data: favs } = useQuery({ queryKey: ['favorites'], queryFn: favoritesApi.list });
  const isFav = favs?.some((f) => f.entityType === 'FILE' && f.entityId === fileId) ?? false;
  const mut = useMutation({
    mutationFn: () => favoritesApi.toggle('FILE', fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });
  return (
    <button
      type="button"
      onClick={() => mut.mutate()}
      aria-pressed={isFav}
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      className={cn(
        'rounded-full p-2 transition',
        isFav ? 'text-rose-400' : 'text-white/60 hover:bg-white/10 hover:text-white',
      )}
    >
      <Heart className={cn('h-4 w-4', isFav && 'fill-current')} />
    </button>
  );
}

function CollectionButton({ fileId }: { fileId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);

  const { data: colls } = useQuery({ queryKey: ['collections'], queryFn: collectionsApi.list });
  const addMut = useMutation({
    mutationFn: (id: string) => collectionsApi.addItem(id, 'FILE', fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      toast.success('Added to collection');
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const newMut = useMutation({
    mutationFn: async () => {
      const c = await collectionsApi.create(name.trim(), undefined, undefined, isPrivate);
      await collectionsApi.addItem(c.id, 'FILE', fileId);
      return c;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Added to "${c.name}"`);
      setOpen(false);
      setCreating(false);
      setName('');
      setIsPrivate(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add to collection"
        aria-expanded={open}
        className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
      >
        <FolderPlus className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-white/10 bg-neutral-950/95 p-1 shadow-2xl backdrop-blur-xl">
          {colls && colls.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {colls.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addMut.mutate(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white/70 hover:bg-white/10"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[10px] text-white/30">
                    {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 py-1.5 text-xs text-white/40">No collections yet</p>
          )}
          <div className="mt-1 border-t border-white/10 pt-1">
            {creating ? (
              <div className="space-y-2 p-2">
                <input
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Collection name"
                  className="w-full rounded-md border-0 bg-white/10 px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                  onKeyDown={(e) => {
                    e.nativeEvent.stopImmediatePropagation();
                    if (e.key === 'Enter' && name.trim()) newMut.mutate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                />
                <label className="flex items-center justify-between rounded-md bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/70">
                  <span className="flex items-center gap-1.5">
                    {isPrivate ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                    {isPrivate ? 'Private collection' : 'Shared collection'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPrivate}
                    onClick={() => setIsPrivate((v) => !v)}
                    className={cn(
                      'relative h-4 w-7 rounded-full transition-colors',
                      isPrivate ? 'bg-white/80' : 'bg-white/15',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-3 w-3 rounded-full bg-neutral-950 transition-transform',
                        isPrivate ? 'translate-x-3.5' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </label>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setName(''); }}
                    className="rounded-md px-2 py-1 text-[10px] text-white/50 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => name.trim() && newMut.mutate()}
                    disabled={!name.trim() || newMut.isPending}
                    className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-neutral-950 disabled:opacity-50"
                  >
                    {newMut.isPending ? 'Creating…' : 'Create + add'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white/50 hover:bg-white/10"
              >
                <Plus className="h-3 w-3" /> New collection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
