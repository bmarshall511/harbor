'use client';

import { useAuth } from '@/lib/use-auth';
import { useAppStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { files as filesApi } from '@/lib/api';
import { getMimeCategory } from '@harbor/utils';
import type { FileDto } from '@harbor/types';
import { AppSidebar } from '@/components/app-sidebar';
import { AppHeader } from '@/components/app-header';
import { DetailPanel } from '@/components/detail-panel';
import { CommandPalette } from '@/components/command-palette';
import { KeyboardShortcutHandler } from '@/components/keyboard-shortcuts';
import { ShortcutHelp } from '@/components/shortcut-help';
import { RealtimeProvider } from '@/components/realtime-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { Lightbox } from '@/components/lightbox';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * The auth gate is its own component. This is what fixes the
 * "rendered fewer hooks than expected" crash: the gate calls only
 * the auth-related hooks (always the same set), and the inner
 * authenticated shell — including `RealtimeProvider`, `Lightbox`,
 * and every other hook-bearing child — only ever mounts in the
 * `authenticated` branch. React never sees a parent component
 * whose hook count varies between renders, because the gate's
 * hook count is invariant and the inner shell is a *separate*
 * component that mounts as a unit.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { authenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !authenticated) {
      router.replace('/login');
    }
  }, [isLoading, authenticated, router]);

  if (isLoading || !authenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}

function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const viewerFileId = useAppStore((s) => s.viewerFileId);
  const viewerFiles = useAppStore((s) => s.viewerFiles);
  const closeViewer = useAppStore((s) => s.closeViewer);
  const setViewerFileId = useAppStore((s) => s.setViewerFileId);
  const openViewer = useAppStore((s) => s.openViewer);
  const viewerFile = viewerFiles.find((f) => f.id === viewerFileId) ?? null;

  // ── Lightbox URL hydration ───────────────────────────────────────
  // When the page is loaded directly with `?view=<id>` (or back/
  // forward navigates to such a URL), the URL→store sync just sets
  // `viewerFileId`. The viewer needs the FULL list of viewable
  // siblings in order to navigate. We fetch the file by id, then
  // fetch its folder/root siblings, filter to viewable items, and
  // populate `viewerFiles` via `openViewer`.
  //
  // The query is enabled only when the store has a `viewerFileId`
  // but no matching file already loaded (i.e. URL hydration, never
  // a normal click-through which already populated `viewerFiles`).
  const needsHydration = !!viewerFileId && !viewerFile;
  const { data: hydratedFile } = useQuery<FileDto>({
    queryKey: ['viewer-hydrate', viewerFileId],
    queryFn: () => filesApi.get(viewerFileId!),
    enabled: needsHydration,
  });
  const { data: hydratedSiblings } = useQuery<FileDto[]>({
    queryKey: ['viewer-hydrate-siblings', hydratedFile?.folderId, hydratedFile?.archiveRootId],
    queryFn: () =>
      hydratedFile?.folderId
        ? filesApi.listByFolder(hydratedFile.folderId)
        : filesApi.listByArchiveRoot(hydratedFile!.archiveRootId),
    enabled: !!hydratedFile && needsHydration,
  });

  useEffect(() => {
    if (!needsHydration) return;
    if (!hydratedFile) return;
    const siblings = hydratedSiblings ?? [];
    const viewable = siblings.filter((f) => {
      const c = getMimeCategory(f.mimeType);
      return c === 'image' || c === 'video';
    });
    // Always include the seed file even if it wasn't in the
    // siblings list yet (cache miss / race).
    const list = viewable.some((f) => f.id === hydratedFile.id)
      ? viewable
      : [hydratedFile, ...viewable];
    openViewer(hydratedFile.id, list);
  }, [needsHydration, hydratedFile, hydratedSiblings, openViewer]);

  return (
    <RealtimeProvider>
      <ImpersonationBanner />
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main id="main-content" className="flex-1 overflow-auto" role="main">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
        <ErrorBoundary>
          <DetailPanel />
        </ErrorBoundary>
        <CommandPalette />
        <KeyboardShortcutHandler />
        <ShortcutHelp />
        {viewerFile && (
          <Lightbox
            file={viewerFile}
            files={viewerFiles}
            onClose={closeViewer}
            onNavigate={setViewerFileId}
          />
        )}
      </div>
    </RealtimeProvider>
  );
}

/**
 * Banner shown when an admin is impersonating another user.
 * Detects the `harbor-impersonating` marker cookie (non-httpOnly)
 * and displays a fixed banner with a "Switch back" button.
 */
function ImpersonationBanner() {
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    setIsImpersonating(document.cookie.includes('harbor-impersonating'));
  }, []);

  if (!isImpersonating) return null;

  const handleStop = () => {
    // Navigate to the stop endpoint which sets cookies via redirect
    window.location.href = '/api/admin/impersonate/stop';
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
      <span>You are viewing as another user</span>
      <button
        onClick={handleStop}
        className="rounded-md bg-amber-950/20 px-2 py-0.5 text-amber-950 hover:bg-amber-950/30"
      >
        Switch back to admin
      </button>
    </div>
  );
}
