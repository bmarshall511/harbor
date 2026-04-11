'use client';

/**
 * Command palette — Cmd+K quick search with inline results.
 *
 * Features:
 *   • Instant search results with thumbnails as you type
 *   • Full keyboard navigation (↑↓ to select, Enter to open, Esc to close)
 *   • Recent searches (from SearchLog) as quick-tap suggestions
 *   • Quick actions when query is empty (archive roots, settings)
 *   • "See all results" footer navigates to /search with the query
 *   • Enter with a query navigates to the full search page
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { search, archiveRoots, getPreviewUrl } from '@/lib/api';
import { getMimeCategory } from '@harbor/utils';
import {
  Search,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
  Folder,
  Settings,
  HardDrive,
  Cloud,
  ArrowRight,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const MIME_ICONS: Record<string, typeof File> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  text: FileText,
  pdf: FileText,
  document: FileText,
};

export function CommandPalette() {
  const isOpen = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, [setOpen]);

  const goToSearch = useCallback(() => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    } else {
      router.push('/search');
    }
    close();
  }, [query, router, close]);

  // Handle escape + global keyboard
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* Palette */}
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-slide-in-up">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search files, folders, people, tags..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                goToSearch();
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) => i + 1);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(0, i - 1));
              }
            }}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {query.length < 2 ? (
            <QuickActions close={close} selectedIndex={selectedIndex} />
          ) : (
            <SearchResults query={query} close={close} selectedIndex={selectedIndex} />
          )}
        </div>

        {/* Footer */}
        {query.length >= 2 && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={goToSearch}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Search className="h-3 w-3" />
              <span>See all results for &ldquo;{query}&rdquo;</span>
              <ArrowRight className="ml-auto h-3 w-3" />
            </button>
          </div>
        )}

        {/* Keyboard hints */}
        <div className="border-t border-border px-4 py-1.5">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1 font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1 font-mono">↵</kbd> Search
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1 font-mono">esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quick actions (shown when query is empty) ────────────────────────────────

function QuickActions({ close, selectedIndex }: { close: () => void; selectedIndex: number }) {
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);
  const router = useRouter();
  const { data: roots } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: archiveRoots.list,
  });

  // Recent searches
  const { data: recentSearches } = useQuery({
    queryKey: ['recent-searches-palette'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/admin/search-analytics');
        if (!res.ok) return [];
        const data = await res.json();
        return (data.recentLogs ?? [])
          .filter((l: { query: string }) => l.query)
          .slice(0, 5)
          .map((l: { query: string }) => l.query) as string[];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const uniqueRecent = [...new Set(recentSearches ?? [])].slice(0, 4);

  return (
    <div className="p-1.5">
      {/* Recent searches */}
      {uniqueRecent.length > 0 && (
        <div className="mb-1">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent searches
          </p>
          {uniqueRecent.map((q, i) => (
            <button
              key={q}
              onClick={() => {
                router.push(`/search?q=${encodeURIComponent(q)}`);
                close();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                selectedIndex === i ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{q}</span>
            </button>
          ))}
        </div>
      )}

      {/* Archive roots */}
      {roots && roots.length > 0 && (
        <div className="mb-1">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Archives
          </p>
          {roots.map((root) => {
            const Icon = root.providerType === 'DROPBOX' ? Cloud : HardDrive;
            return (
              <button
                key={root.id}
                onClick={() => {
                  setActiveArchiveRootId(root.id);
                  router.push('/');
                  close();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{root.name}</span>
                <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground/50" />
              </button>
            );
          })}
        </div>
      )}

      {/* Settings */}
      <button
        onClick={() => { router.push('/settings'); close(); }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/50"
      >
        <Settings className="h-3.5 w-3.5 text-muted-foreground" />
        <span>Settings</span>
      </button>
    </div>
  );
}

// ─── Search results with thumbnails ───────────────────────────────────────────

function SearchResults({ query, close, selectedIndex }: { query: string; close: () => void; selectedIndex: number }) {
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);
  const router = useRouter();

  const { data: results, isLoading } = useQuery({
    queryKey: ['cmd-search', query],
    queryFn: () => search.query({ query, limit: 8 }),
    enabled: query.length >= 2,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const files = results?.files ?? [];
  const folders = results?.folders ?? [];
  const hasResults = files.length > 0 || folders.length > 0;

  if (!hasResults) {
    return (
      <div className="py-8 text-center">
        <Search className="mx-auto h-8 w-8 text-muted-foreground/30" />
        <p className="mt-2 text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
        <p className="mt-1 text-xs text-muted-foreground/60">Try a different search or use the full search page for filters</p>
      </div>
    );
  }

  let itemIndex = 0;

  return (
    <div className="p-1.5">
      {/* Folders */}
      {folders.length > 0 && (
        <div className="mb-1">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Folders ({folders.length})
          </p>
          {folders.map((folder) => {
            const idx = itemIndex++;
            return (
              <button
                key={folder.id}
                onClick={() => {
                  setActiveFolderId(folder.id);
                  router.push('/');
                  close();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
                  selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Folder className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{folder.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{folder.path}</p>
                </div>
                {folder.fileCount !== undefined && (
                  <span className="text-[10px] text-muted-foreground">{folder.fileCount} files</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Files */}
      {files.length > 0 && (
        <div>
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Files ({results?.total ?? files.length})
          </p>
          {files.map((file) => {
            const idx = itemIndex++;
            const category = getMimeCategory(file.mimeType);
            const Icon = MIME_ICONS[category] ?? File;
            const hasThumbnail = file.previews?.length > 0 || category === 'image';

            return (
              <button
                key={file.id}
                onClick={() => {
                  openDetailPanel('file', file.id);
                  close();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
                  selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                {/* Thumbnail */}
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                  {hasThumbnail ? (
                    <img
                      src={getPreviewUrl(file.id, 'THUMBNAIL')}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : null}
                  <div className={cn(
                    'flex h-full w-full items-center justify-center',
                    hasThumbnail && 'hidden',
                  )}>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{file.title ?? file.name}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{category}</span>
                    {file.tags?.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="truncate">{file.tags.slice(0, 2).map((t) => t.name).join(', ')}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
