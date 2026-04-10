'use client';

/**
 * Recommendation strip — "for you" content surface.
 *
 * Used identically by:
 *   • The dashboard (no scope) — global picks across the library
 *   • The archive browser (folder/root scope) — picks limited to
 *     the current directory
 *
 * The visual treatment is the SAME in both places so the experience
 * is consistent: a section heading, an "On this day" mini-row when
 * there are matches, then a responsive grid of recommendation cards.
 *
 * The data comes from POST /api/recommendations, fed with the user's
 * recently-viewed IDs and any favorites as "seeds." The scorer ranks
 * candidates on folder, shared tags, shared custom metadata atoms,
 * "this day in history," and rating. See `app/api/recommendations`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, History } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useRecentlyViewedFiles } from '@/lib/recently-viewed';
import { recommendations as recApi, favorites as favoritesApi, getPreviewUrl } from '@/lib/api';
import { friendlyName, getMimeCategory } from '@harbor/utils';
import { cn } from '@/lib/cn';
import { FileQuickActions } from '@/components/file-quick-actions';

interface RecommendationStripProps {
  /** Narrow to a particular root or folder. Empty = global (dashboard). */
  scope?: { archiveRootId?: string; folderId?: string };
  /** Section heading. Defaults: "For You" globally, "Recommended here" in a directory. */
  title?: string;
  /** Optional subtitle below the heading. */
  subtitle?: string;
  /** Shown only when there are no recommendations to surface. */
  emptyHint?: string;
  /** How many to fetch. Defaults to 16. */
  limit?: number;
  /** When true, hides the entire section if there are no items. */
  hideWhenEmpty?: boolean;
}

export function RecommendationStrip({
  scope = {},
  title,
  subtitle,
  emptyHint,
  limit = 16,
  hideWhenEmpty = false,
}: RecommendationStripProps) {
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const viewedFiles = useRecentlyViewedFiles(25);

  const { data: favs = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: favoritesApi.list,
    staleTime: 60_000,
  });

  // Build a stable seed-id list: most-recent views first, then any
  // favorites we don't already have. Cap at 25.
  const seedIds = useMemo(() => {
    const seen = new Set<string>();
    const seeds: string[] = [];
    for (const f of viewedFiles) {
      if (!seen.has(f.id)) { seen.add(f.id); seeds.push(f.id); }
      if (seeds.length >= 25) break;
    }
    for (const f of favs) {
      if (f.entityType !== 'FILE') continue;
      if (seen.has(f.entityId)) continue;
      seen.add(f.entityId);
      seeds.push(f.entityId);
      if (seeds.length >= 25) break;
    }
    return seeds;
  }, [viewedFiles, favs]);

  const { data, isLoading } = useQuery({
    queryKey: ['recommendations', seedIds.join(','), scope.archiveRootId ?? '', scope.folderId ?? '', limit],
    queryFn: () => recApi.fetch({ seedIds, scope, limit }),
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const todayItems = useMemo(
    () => items.filter((it) => it.reasons.some((r) => r.startsWith('On this day'))),
    [items],
  );
  const restItems = useMemo(
    () => items.filter((it) => !it.reasons.some((r) => r.startsWith('On this day'))),
    [items],
  );

  if (hideWhenEmpty && !isLoading && items.length === 0) return null;

  const isScoped = !!(scope.archiveRootId || scope.folderId);
  const headingText = title ?? (isScoped ? 'Recommended here' : 'For You');

  return (
    <section aria-labelledby="rec-heading" className="space-y-4">
      {/* Section header — matches the rest of the app's quiet,
          uppercase label style. No gradient billboards. */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <h2
            id="rec-heading"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {headingText}
          </h2>
          {subtitle && (
            <span className="text-[11px] text-muted-foreground/60">— {subtitle}</span>
          )}
        </div>
        {seedIds.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60">{seedIds.length} signals</span>
        )}
      </div>

      {/* "On this day" mini-row */}
      {todayItems.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <History className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              On this day
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {todayItems.slice(0, 8).map((it) => (
              <RecommendationCard
                key={it.file.id}
                fileId={it.file.id}
                name={it.file.title ?? it.file.name}
                mimeType={it.file.mimeType}
                reasons={it.reasons}
                onOpen={() => openDetailPanel('file', it.file.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : restItems.length === 0 && todayItems.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          {emptyHint ?? 'Open a few files to get personalized picks.'}
        </p>
      ) : restItems.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {restItems.map((it) => (
            <RecommendationCard
              key={it.file.id}
              fileId={it.file.id}
              name={it.file.title ?? it.file.name}
              mimeType={it.file.mimeType}
              reasons={it.reasons}
              onOpen={() => openDetailPanel('file', it.file.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RecommendationCard({
  fileId,
  name,
  mimeType,
  reasons,
  onOpen,
}: {
  fileId: string;
  name: string;
  mimeType: string | null;
  reasons: string[];
  onOpen: () => void;
}) {
  const cat = getMimeCategory(mimeType);
  const isImage = cat === 'image' || cat === 'video';
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={name}
        title={reasons[0] ? `${name}\n— ${reasons[0]}` : name}
        className={cn(
          'block w-full overflow-hidden rounded-lg border border-border bg-card text-left',
          'transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
        )}
      >
        <div className="relative aspect-square w-full bg-muted">
          {isImage ? (
            <img
              src={getPreviewUrl(fileId, 'THUMBNAIL')}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              {cat}
            </div>
          )}
          {reasons.length > 0 && (
            <div className="absolute inset-x-1 bottom-1 truncate rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white/85 backdrop-blur">
              {reasons[0]}
            </div>
          )}
        </div>
        <p className="truncate px-1.5 py-1 text-[10px] font-medium" title={name}>
          {friendlyName(name)}
        </p>
      </button>
      <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <FileQuickActions fileId={fileId} size="card" variant="dark" />
      </div>
    </div>
  );
}
