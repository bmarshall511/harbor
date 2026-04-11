'use client';

/**
 * /search — dedicated full-page search with URL-driven state.
 *
 * Every filter, the query, sort, and pagination are serialized into
 * flat query params so the URL is shareable and bookmarkable:
 *
 *   /search?q=sunset&tags=nature,vacation&mf_people=Ben&sort=date
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  Search as SearchIcon,
  X,
  Clock,
  Tags,
  User,
  FileImage,
  FileVideo,
  Sparkles,
} from 'lucide-react';

import { search as searchApi, tags as tagsApi } from '@/lib/api';
import { getPreviewUrl } from '@/lib/api';
import { FileGrid } from '@/components/file-grid';
import { FolderCards } from '@/components/folder-cards';
import { EmptyState } from '@/components/empty-state';
import { SearchFilterBar, type SearchFilters } from '@/components/search-filter-bar';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { getMimeCategory } from '@harbor/utils';
import type { SearchParams, SearchResponse } from '@harbor/types';

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}

// ─── URL ↔ state helpers ──────────────────────────────────────────────────────

const META_FIELD_PREFIX = 'mf_';

function parseFiltersFromParams(params: URLSearchParams): SearchFilters {
  const metaFields: Record<string, string[]> = {};
  params.forEach((value, key) => {
    if (key.startsWith(META_FIELD_PREFIX)) {
      metaFields[key.slice(META_FIELD_PREFIX.length)] = value.split(',').filter(Boolean);
    }
  });
  return {
    tags: params.get('tags')?.split(',').filter(Boolean) ?? [],
    mimeTypes: params.get('type')?.split(',').filter(Boolean) ?? [],
    archiveRootIds: params.get('root')?.split(',').filter(Boolean) ?? [],
    ratingMin: params.get('rmin') ? Number(params.get('rmin')) : undefined,
    ratingMax: params.get('rmax') ? Number(params.get('rmax')) : undefined,
    dateFrom: params.get('from') ?? undefined,
    dateTo: params.get('to') ?? undefined,
    hasFaces: params.get('faces') === '1' ? true : undefined,
    metaFields,
  };
}

function filtersToParams(q: string, filters: SearchFilters, sort: string, order: string, page: number): URLSearchParams {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (filters.tags.length) p.set('tags', filters.tags.join(','));
  if (filters.mimeTypes.length) p.set('type', filters.mimeTypes.join(','));
  if (filters.archiveRootIds.length) p.set('root', filters.archiveRootIds.join(','));
  if (filters.ratingMin !== undefined) p.set('rmin', String(filters.ratingMin));
  if (filters.ratingMax !== undefined) p.set('rmax', String(filters.ratingMax));
  if (filters.dateFrom) p.set('from', filters.dateFrom);
  if (filters.dateTo) p.set('to', filters.dateTo);
  if (filters.hasFaces) p.set('faces', '1');
  for (const [key, vals] of Object.entries(filters.metaFields)) {
    if (vals.length > 0) p.set(`${META_FIELD_PREFIX}${key}`, vals.join(','));
  }
  if (sort && sort !== 'relevance') p.set('sort', sort);
  if (order && order !== 'desc') p.set('order', order);
  if (page > 1) p.set('page', String(page));
  return p;
}

function buildSearchParams(
  q: string, filters: SearchFilters, sort: string, order: string, page: number, limit: number,
): SearchParams & { includeFacets: boolean } {
  const people = filters.metaFields['people'] ?? [];
  const adultContent = filters.metaFields['adult_content'] ?? [];
  return {
    query: q,
    tags: filters.tags.length ? filters.tags : undefined,
    people: people.length ? people : undefined,
    mimeTypes: filters.mimeTypes.length ? filters.mimeTypes : undefined,
    archiveRootIds: filters.archiveRootIds.length ? filters.archiveRootIds : undefined,
    adultContent: adultContent.length ? adultContent : undefined,
    ratingMin: filters.ratingMin,
    ratingMax: filters.ratingMax,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasFaces: filters.hasFaces,
    sortBy: (sort as SearchParams['sortBy']) || 'relevance',
    sortOrder: (order as SearchParams['sortOrder']) || 'desc',
    page, limit, includeFacets: true,
  };
}

// ─── Main content ─────────────────────────────────────────────────────────────

function SearchContent() {
  const router = useRouter();
  const params = useSearchParams();

  const initialQ = params.get('q') ?? '';
  const initialFilters = parseFiltersFromParams(params);
  const initialSort = params.get('sort') ?? 'relevance';
  const initialOrder = params.get('order') ?? 'desc';
  const initialPage = Number(params.get('page') ?? '1');

  const [query, setQuery] = useState(initialQ);
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [sort, setSort] = useState(initialSort);
  const [order, setOrder] = useState(initialOrder);
  const [page, setPage] = useState(initialPage);
  const inputRef = useRef<HTMLInputElement>(null);
  const LIMIT = 60;

  const [shouldLog, setShouldLog] = useState(false);
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const hasQuery = query.trim().length > 0;
  const hasMetaFilters = Object.values(filters.metaFields).some((v) => v.length > 0);
  const hasFilters = !!(
    filters.tags.length || filters.mimeTypes.length ||
    filters.archiveRootIds.length || hasMetaFilters ||
    filters.hasFaces || filters.dateFrom || filters.dateTo ||
    filters.ratingMin !== undefined || filters.ratingMax !== undefined
  );
  const shouldSearch = hasQuery || hasFilters;

  useEffect(() => {
    const p = filtersToParams(query, filters, sort, order, page);
    const newSearch = p.toString();
    const currentSearch = window.location.search.replace(/^\?/, '');
    if (newSearch !== currentSearch) {
      router.replace(`/search${newSearch ? `?${newSearch}` : ''}`, { scroll: false });
    }
  }, [query, filters, sort, order, page, router]);

  const setBrowseContext = useAppStore((s) => s.setBrowseContext);
  const clearBrowseContext = useAppStore((s) => s.clearBrowseContext);

  const searchParams = useMemo(
    () => buildSearchParams(query, filters, sort, order, page, LIMIT),
    [query, filters, sort, order, page],
  );

  const { data, isLoading, isFetching } = useQuery<SearchResponse>({
    queryKey: ['search', searchParams],
    queryFn: () => searchApi.query({ ...searchParams, logSearch: shouldLog } as Parameters<typeof searchApi.query>[0]),
    enabled: shouldSearch,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: 2,
  });

  useEffect(() => {
    if (shouldLog && data) setShouldLog(false);
  }, [shouldLog, data]);

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const total = data?.total ?? 0;
  const facets = data?.facets;
  const hasMore = data?.hasMore ?? false;
  const isEmpty = shouldSearch && !isLoading && files.length === 0 && folders.length === 0;

  useEffect(() => {
    if (files.length > 0) setBrowseContext('Search results', files);
    return () => clearBrowseContext();
  }, [files, setBrowseContext, clearBrowseContext]);

  const handleQueryChange = useCallback((newQ: string) => {
    setQuery(newQ);
    setPage(1);
    setShouldLog(false);
    if (logTimerRef.current) clearTimeout(logTimerRef.current);
    logTimerRef.current = setTimeout(() => setShouldLog(true), 2000);
  }, []);

  const handleFiltersChange = useCallback((newFilters: SearchFilters) => {
    setFilters(newFilters);
    setPage(1);
    setShouldLog(true);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* ── Search header ──────────────────────────────────────── */}
      <div className="border-b border-border bg-card/50">
        {/* Large centered search input */}
        <div className="mx-auto max-w-2xl px-4 pt-6 pb-4">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search files, tags, people, metadata..."
              className="w-full rounded-xl border border-border bg-background py-3.5 pl-12 pr-12 text-base shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              aria-label="Search"
            />
            {query && (
              <button
                onClick={() => handleQueryChange('')}
                className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {isFetching && (
              <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* People avatar strip */}
        <PeopleAvatarStrip
          selectedPeople={filters.metaFields['people'] ?? []}
          onToggle={(name) => {
            const current = filters.metaFields['people'] ?? [];
            const next = current.includes(name)
              ? current.filter((n) => n !== name)
              : [...current, name];
            handleFiltersChange({ ...filters, metaFields: { ...filters.metaFields, people: next } });
          }}
        />

        {/* Filter bar + sort */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="flex-1">
            <SearchFilterBar
              filters={filters}
              onFiltersChange={handleFiltersChange}
              facets={facets ? { tags: facets.tags, people: facets.people, mimeTypes: facets.mimeTypes } : undefined}
            />
          </div>
          <select
            value={`${sort}-${order}`}
            onChange={(e) => {
              const [s, o] = e.target.value.split('-');
              setSort(s);
              setOrder(o);
            }}
            className="hidden sm:block h-8 rounded-lg border border-border bg-background px-2 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Sort"
          >
            <option value="relevance-desc">Most relevant</option>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="size-desc">Largest first</option>
          </select>
        </div>

        {/* Result summary bar */}
        {shouldSearch && !isLoading && (
          <div className="border-t border-border bg-muted/30 px-4 py-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
                {query && <> for <strong className="text-foreground">&ldquo;{query}&rdquo;</strong></>}
                {facets && facets.totalFiles > 0 && (
                  <> &middot; {facets.mimeTypes.slice(0, 3).map((m) => `${m.count} ${m.value.split('/')[0]}`).join(', ')}</>
                )}
              </span>
              <span className="tabular-nums">{data?.page ?? 1} of {Math.ceil(total / LIMIT) || 1}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Results ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Idle state — show suggestions */}
        {!shouldSearch && (
          <SearchIdleState
            onSearch={(q) => handleQueryChange(q)}
            onTagClick={(tag) => handleFiltersChange({ ...filters, tags: [...filters.tags, tag] })}
          />
        )}

        {/* Loading */}
        {isLoading && shouldSearch && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Searching...</p>
          </div>
        )}

        {/* Empty */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <SearchIcon className="h-10 w-10 text-muted-foreground/20" />
            <h3 className="mt-4 text-base font-semibold">No results found</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {query ? `Nothing matched "${query}"` : 'No files match the current filters'}.
              Try different keywords or broaden your filters.
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && !isEmpty && shouldSearch && (
          <div className="p-4 space-y-6">
            {folders.length > 0 && (
              <section>
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Folders ({folders.length})
                </h2>
                <FolderCards folders={folders} />
              </section>
            )}
            {files.length > 0 && (
              <section>
                {folders.length > 0 && (
                  <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Files ({total})
                  </h2>
                )}
                <FileGrid files={files} />
              </section>
            )}

            {/* Pagination */}
            {(hasMore || page > 1) && (
              <div className="flex items-center justify-center gap-3 pt-4 pb-8">
                <button
                  type="button"
                  onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo(0, 0); }}
                  disabled={page <= 1}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-accent"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Page {page} of {Math.ceil(total / LIMIT) || 1}
                </span>
                <button
                  type="button"
                  onClick={() => { setPage((p) => p + 1); window.scrollTo(0, 0); }}
                  disabled={!hasMore}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-accent"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Idle state — shown before the user types anything ────────────────────────

function SearchIdleState({
  onSearch,
  onTagClick,
}: {
  onSearch: (q: string) => void;
  onTagClick: (tag: string) => void;
}) {
  // Popular tags
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    staleTime: 60_000,
  });
  const topTags = (allTags ?? []).slice(0, 12);

  // Recent searches (user's own)
  const { data: recentSearches } = useQuery({
    queryKey: ['recent-searches-idle'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/admin/search-analytics');
        if (!res.ok) return [];
        const data = await res.json();
        return [...new Set(
          (data.recentLogs ?? [])
            .filter((l: { query: string }) => l.query)
            .map((l: { query: string }) => l.query),
        )].slice(0, 6) as string[];
      } catch { return []; }
    },
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 space-y-10">
      {/* Hero */}
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <SearchIcon className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">Search your archive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across files, metadata, tags, people, transcripts, and AI descriptions.
        </p>
      </div>

      {/* Recent searches */}
      {recentSearches && recentSearches.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3 w-3" /> Recent searches
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {recentSearches.map((q) => (
              <button
                key={q}
                onClick={() => onSearch(q)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Popular tags */}
      {topTags.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Tags className="h-3 w-3" /> Popular tags
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {topTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => onTagClick(tag.name)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              >
                {tag.color && (
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                )}
                {tag.name}
                <span className="text-muted-foreground">{tag.usageCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Search tips
        </h3>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>Use the filter pills above to narrow by type, tags, people, or date</li>
          <li>Click a person avatar to quickly filter by who appears in files</li>
          <li>Search works across filenames, titles, tags, people, AI descriptions, and OCR text</li>
          <li>Results update as you type — press Enter or use Cmd+K for quick search</li>
        </ul>
      </div>
    </div>
  );
}

// ─── People avatar strip ──────────────────────────────────────────────────────

function PeopleAvatarStrip({
  selectedPeople,
  onToggle,
}: {
  selectedPeople: string[];
  onToggle: (name: string) => void;
}) {
  const { data: persons } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      if (!res.ok) return [];
      return res.json() as Promise<Array<{
        id: string; name: string | null; avatarUrl: string | null; faceCount: number;
      }>>;
    },
    staleTime: 60_000,
  });

  const namedPersons = (persons ?? []).filter((p) => p.name);
  if (namedPersons.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-2 scrollbar-none">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        People
      </span>
      {namedPersons.map((person) => {
        const isSelected = selectedPeople.includes(person.name!);
        return (
          <button
            key={person.id}
            type="button"
            onClick={() => onToggle(person.name!)}
            title={person.name!}
            className={cn(
              'group relative flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1.5 transition',
              isSelected ? 'bg-primary/10' : 'hover:bg-accent',
            )}
          >
            <div className={cn(
              'flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 transition',
              isSelected ? 'border-primary shadow-md shadow-primary/20' : 'border-transparent group-hover:border-border',
            )}>
              {person.avatarUrl ? (
                <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
            <span className={cn(
              'max-w-[4rem] truncate text-[10px]',
              isSelected ? 'font-medium text-primary' : 'text-muted-foreground',
            )}>
              {person.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
