'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { search, archiveRoots, tags as tagsApi } from '@/lib/api';
import {
  Search,
  FileImage,
  Folder,
  Tag,
  Settings,
  HardDrive,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export function CommandPalette() {
  const isOpen = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, [setOpen]);

  /** Navigate to the full search page with the current query. */
  const goToSearch = useCallback(() => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    } else {
      router.push('/search');
    }
    close();
  }, [query, router, close]);

  // Handle escape
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />

      {/* Palette */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-slide-in-up">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search files, folders, tags..."
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
            }}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto p-2">
          {query.length < 2 ? (
            <QuickActions close={close} />
          ) : (
            <SearchResults query={query} close={close} />
          )}
        </div>

        {/* Footer — always visible "See all results" link */}
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
      </div>
    </div>
  );
}

function QuickActions({ close }: { close: () => void }) {
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);

  const { data: roots } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: archiveRoots.list,
  });

  return (
    <div>
      <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Quick Actions
      </p>
      {roots?.map((root) => (
        <button
          key={root.id}
          onClick={() => {
            setActiveArchiveRootId(root.id);
            close();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span>Go to {root.name}</span>
          <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </button>
      ))}
      <button
        onClick={close}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
      >
        <Settings className="h-4 w-4 text-muted-foreground" />
        <span>Open Settings</span>
      </button>
    </div>
  );
}

function SearchResults({ query, close }: { query: string; close: () => void }) {
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', query],
    queryFn: () => search.query({ query, limit: 10 }),
    enabled: query.length >= 2,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  const hasFiles = results?.files?.length;
  const hasFolders = results?.folders?.length;

  if (!hasFiles && !hasFolders) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No results found for "{query}"
      </div>
    );
  }

  return (
    <div>
      {hasFolders ? (
        <>
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Folders
          </p>
          {results.folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => {
                setActiveFolderId(folder.id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{folder.path}</span>
            </button>
          ))}
        </>
      ) : null}

      {hasFiles ? (
        <>
          <p className="mt-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Files
          </p>
          {results.files.map((file) => (
            <button
              key={file.id}
              onClick={() => {
                openDetailPanel('file', file.id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <FileImage className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{file.title ?? file.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {file.mimeType?.split('/')[1] ?? ''}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
