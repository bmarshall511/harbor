'use client';

import { Suspense, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { ArchiveBrowser } from '@/components/archive-browser';
import { Dashboard } from '@/components/dashboard';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <HomeContent />
    </Suspense>
  );
}

/**
 * URL ↔ store sync model
 * ──────────────────────
 * The URL is the source of truth on first paint. We hydrate the store
 * from `window.location.search` *synchronously* inside a `useState`
 * initializer so that the very first render of this component already
 * sees the correct navigation + detail-panel + viewer state.
 *
 * Query params:
 *   ?root=<archiveRootId>      — current archive root
 *   ?folder=<folderId>         — current folder
 *   ?file=<fileId>             — detail panel open for this file
 *   ?view=<fileId>             — lightbox open on this file
 *
 * Any of these can be present independently so a link can point
 * straight at (e.g.) a specific file open in the lightbox inside
 * a specific folder:
 *
 *   /?root=r1&folder=f1&view=f3
 *
 * Refreshing that URL reopens everything exactly where it was.
 */
function HomeContent() {
  // ── 1. Synchronous hydration (runs exactly once, before selectors) ──
  useState(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const rootFromUrl = params.get('root');
    const folderFromUrl = params.get('folder');
    const fileFromUrl = params.get('file');
    const viewFromUrl = params.get('view');
    if (!rootFromUrl && !folderFromUrl && !fileFromUrl && !viewFromUrl) return null;

    const store = useAppStore.getState();

    // setActiveArchiveRootId clears activeFolderId, so apply root first
    // then folder.
    if (rootFromUrl && rootFromUrl !== store.activeArchiveRootId) {
      store.setActiveArchiveRootId(rootFromUrl);
    }
    if (folderFromUrl && folderFromUrl !== useAppStore.getState().activeFolderId) {
      store.setActiveFolderId(folderFromUrl);
    }

    // Detail panel — open straight to the requested file id.
    if (fileFromUrl) {
      store.openDetailPanel('file', fileFromUrl);
    }

    // Lightbox — record the file id only. The authenticated shell's
    // hydration effect resolves the file + its sibling list and
    // calls `openViewer` with the real array. We use
    // `setViewerFileId` directly so the lightbox doesn't render
    // with an incomplete list during the hydration window.
    if (viewFromUrl) {
      store.setViewerFileId(viewFromUrl);
    }
    return null;
  });

  // ── 2. Selectors (now see post-hydration values) ────────────────────
  const activeArchiveRootId = useAppStore((s) => s.activeArchiveRootId);
  const activeFolderId = useAppStore((s) => s.activeFolderId);
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);
  const detailPanelOpen = useAppStore((s) => s.detailPanelOpen);
  const detailPanelEntityType = useAppStore((s) => s.detailPanelEntityType);
  const detailPanelEntityId = useAppStore((s) => s.detailPanelEntityId);
  const viewerFileId = useAppStore((s) => s.viewerFileId);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const closeDetailPanel = useAppStore((s) => s.closeDetailPanel);
  const setViewerFileIdAction = useAppStore((s) => s.setViewerFileId);
  const closeViewer = useAppStore((s) => s.closeViewer);

  // ── 3. Store → URL sync ─────────────────────────────────────────────
  // First run: closure already has hydrated values, so newUrl matches
  // currentUrl and we skip the write entirely. Subsequent runs are
  // user-driven navigations → pushState so browser back/forward work.
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeArchiveRootId) params.set('root', activeArchiveRootId);
    if (activeFolderId) params.set('folder', activeFolderId);
    // Only surface the detail-panel param when it's open on a file;
    // folder details are view state only (breadcrumbs carry the folder).
    if (detailPanelOpen && detailPanelEntityType === 'file' && detailPanelEntityId) {
      params.set('file', detailPanelEntityId);
    }
    if (viewerFileId) params.set('view', viewerFileId);
    const search = params.toString();
    const newUrl = search ? `/?${search}` : '/';
    const currentUrl = window.location.pathname + window.location.search;
    if (newUrl !== currentUrl) {
      window.history.pushState(null, '', newUrl);
    }
  }, [
    activeArchiveRootId,
    activeFolderId,
    detailPanelOpen,
    detailPanelEntityType,
    detailPanelEntityId,
    viewerFileId,
  ]);

  // ── 4. Back/forward → store sync ────────────────────────────────────
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      const rootId = params.get('root');
      const folderId = params.get('folder');
      const fileId = params.get('file');
      const viewId = params.get('view');
      const state = useAppStore.getState();

      if (rootId !== state.activeArchiveRootId) {
        setActiveArchiveRootId(rootId);
      }
      // Read again because setActiveArchiveRootId clears folder
      if (folderId !== useAppStore.getState().activeFolderId) {
        setActiveFolderId(folderId);
      }

      // Detail panel
      if (fileId) {
        if (
          !useAppStore.getState().detailPanelOpen ||
          useAppStore.getState().detailPanelEntityId !== fileId
        ) {
          openDetailPanel('file', fileId);
        }
      } else if (useAppStore.getState().detailPanelOpen) {
        closeDetailPanel();
      }

      // Lightbox — back/forward sets just the id; the shell's
      // hydration effect picks up the file + sibling list.
      if (viewId) {
        if (useAppStore.getState().viewerFileId !== viewId) {
          setViewerFileIdAction(viewId);
        }
      } else if (useAppStore.getState().viewerFileId) {
        closeViewer();
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setActiveArchiveRootId, setActiveFolderId, openDetailPanel, closeDetailPanel, setViewerFileIdAction, closeViewer]);

  if (!activeArchiveRootId) {
    return <Dashboard />;
  }

  return <ArchiveBrowser archiveRootId={activeArchiveRootId} />;
}
