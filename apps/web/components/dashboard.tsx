'use client';

/**
 * Dashboard — Harbor's home page.
 *
 * Layout (top to bottom, designed to fit a typical viewport without
 * forcing the user to scroll a long stack of independent sections):
 *
 *   1. Stat row — at-a-glance counts (clickable to filter the tabbed
 *      surface below). One row, four cells.
 *
 *   2. Recommendation strip — same component the directory pages use,
 *      so the experience is consistent. Two grid rows of cards plus
 *      an "On this day" mini-row when applicable.
 *
 *   3. Tabbed media surface — a single section the user toggles
 *      between Recently Viewed / Recently Added / Favorites /
 *      Collections / Library. Replaces the old long stack so the
 *      dashboard fits in a screen and feels interactive.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { getPreviewUrl } from '@/lib/api';
import { useRecentlyViewedFiles } from '@/lib/recently-viewed';
import { RecommendationStrip } from '@/components/recommendation-strip';
import type { FileDto } from '@harbor/types';
import { getMimeCategory, friendlyName } from '@harbor/utils';
import { cn } from '@/lib/cn';
import {
  Archive, FileImage, FileVideo, FileAudio, FileText, Folder,
  Heart, LayoutList, Clock, Eye, File,
} from 'lucide-react';

// Re-export trackView from the dedicated module so existing imports
// from '@/components/dashboard' continue to work without churn.
export { trackView } from '@/lib/recently-viewed';

interface DashboardData {
  stats: { totalFiles: number; totalFolders: number; totalArchives: number };
  typeCounts: Array<{ category: string; count: number }>;
  recentFiles: Array<{ id: string; name: string; title: string | null; mimeType: string | null; size: number; hasPreview: boolean; indexedAt: string | null }>;
  recentFavorites: Array<{ id: string; entityId: string; name: string | null; title: string | null; mimeType: string | null; hasPreview: boolean; createdAt: string }>;
  recentCollections: Array<{ id: string; name: string; color: string | null; itemCount: number }>;
}

type Tab = 'recent-views' | 'recent-added' | 'favorites' | 'collections' | 'library';

const TABS: Array<{ id: Tab; label: string; icon: typeof File }> = [
  { id: 'recent-views', label: 'Recently Viewed', icon: Eye },
  { id: 'recent-added', label: 'Recently Added', icon: Clock },
  { id: 'favorites', label: 'Favorites', icon: Heart },
  { id: 'collections', label: 'Collections', icon: LayoutList },
  { id: 'library', label: 'Library', icon: FileImage },
];

export function Dashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => { const r = await fetch('/api/dashboard'); return r.json(); },
  });
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const [tab, setTab] = useState<Tab>('recent-views');

  const viewedFiles = useRecentlyViewedFiles(18);

  if (isLoading || !data) {
    return (
      <div className="w-full p-6 space-y-6">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in p-4 sm:p-6 space-y-6">
      {/* ── Stat row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat icon={File} label="Files" value={data.stats.totalFiles} />
        <Stat icon={Folder} label="Folders" value={data.stats.totalFolders} />
        <Stat icon={Archive} label="Archives" value={data.stats.totalArchives} />
        <Stat icon={Heart} label="Favorites" value={data.recentFavorites.length} />
      </div>

      {/* ── Recommendations ─────────────────────────────────────── */}
      <RecommendationStrip
        scope={{}}
        emptyHint="Open a few files to get personalized picks."
      />

      {/* ── Tabbed media surface ─────────────────────────────────── */}
      <section
        aria-label="Browse"
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        {/* Tab strip */}
        <div className="flex gap-0 border-b border-border overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
                )}
                aria-pressed={isActive}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {isActive && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {tab === 'recent-views' && (
            viewedFiles.length > 0 ? (
              <ThumbGrid files={viewedFiles.slice(0, 18)} onOpen={(id) => openDetailPanel('file', id)} />
            ) : (
              <Empty text="Open a file to start tracking your viewing history" />
            )
          )}

          {tab === 'recent-added' && (
            data.recentFiles.length > 0 ? (
              <ThumbGrid
                files={data.recentFiles.slice(0, 18)}
                onOpen={(id) => openDetailPanel('file', id)}
              />
            ) : (
              <Empty text="Index an archive to see recent additions" />
            )
          )}

          {tab === 'favorites' && (
            data.recentFavorites.length > 0 ? (
              <ThumbGrid
                files={data.recentFavorites
                  .filter((f) => f.name)
                  .slice(0, 18)
                  .map((f) => ({
                    id: f.entityId,
                    name: f.name!,
                    title: f.title,
                    mimeType: f.mimeType,
                    hasPreview: f.hasPreview,
                  }))}
                onOpen={(id) => openDetailPanel('file', id)}
              />
            ) : (
              <Empty text="Favorite items to see them here" />
            )
          )}

          {tab === 'collections' && (
            data.recentCollections.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {data.recentCollections.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/30"
                  >
                    <LayoutList
                      className="h-4 w-4 shrink-0"
                      style={c.color ? { color: c.color } : {}}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.itemCount} item{c.itemCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="Create a collection to organize your items" />
            )
          )}

          {tab === 'library' && (
            data.typeCounts.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {data.typeCounts.map((tc) => (
                  <div
                    key={tc.category}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <TypeIcon category={tc.category} />
                    <div>
                      <p className="text-sm font-semibold">{tc.count.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground">{tc.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No files indexed yet" />
            )
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────

function ThumbGrid({
  files,
  onOpen,
}: {
  files: Array<{
    id: string;
    name: string;
    title?: string | null;
    mimeType: string | null;
    hasPreview?: boolean;
    previews?: { id: string }[];
  }>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9">
      {files.map((f) => (
        <Thumb key={f.id} file={f} onClick={() => onOpen(f.id)} />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof File; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function Thumb({
  file,
  onClick,
}: {
  file: {
    id: string;
    name: string;
    title?: string | null;
    mimeType: string | null;
    hasPreview?: boolean;
    previews?: { id: string }[];
  };
  onClick: () => void;
}) {
  const cat = getMimeCategory(file.mimeType);
  const hasPreview = file.hasPreview ?? (file.previews && file.previews.length > 0);
  // Prefer the user-set title metadata when present; fall back to a
  // friendly version of the filename. This makes cards reflect any
  // curation work the user has done.
  const displayName = file.title?.trim() || friendlyName(file.name);
  return (
    <button
      onClick={onClick}
      className="group overflow-hidden rounded-lg border border-border bg-background transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md"
    >
      <div className="aspect-square bg-muted">
        {hasPreview || cat === 'image' ? (
          <img
            src={getPreviewUrl(file.id, 'THUMBNAIL')}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <TypeIcon category={cat === 'video' ? 'Videos' : cat === 'audio' ? 'Audio' : 'Documents'} />
          </div>
        )}
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] font-medium" title={file.name}>
        {displayName}
      </p>
    </button>
  );
}

function TypeIcon({ category }: { category: string }) {
  const icons: Record<string, typeof File> = {
    Images: FileImage, Videos: FileVideo, Audio: FileAudio, Documents: FileText,
  };
  const colors: Record<string, string> = {
    Images: 'text-blue-500',
    Videos: 'text-purple-500',
    Audio: 'text-amber-500',
    Documents: 'text-green-500',
  };
  const Icon = icons[category] ?? File;
  return <Icon className={cn('h-5 w-5', colors[category] ?? 'text-muted-foreground')} />;
}
