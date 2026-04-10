'use client';

/**
 * /search — dedicated full-page search with URL-driven state.
 *
 * Every filter, the query, sort, and pagination are serialized into
 * flat query params so the URL is shareable and bookmarkable:
 *
 *   /search?q=sunset&tags=nature,vacation&people=Ben&sort=date&order=desc
 *
 * Typing in the search bar updates the URL (debounced), which triggers
 * a React Query fetch. Faceted counts load alongside results so the
 * filter bar always shows how many items each facet would return.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  Search as SearchIcon,
  SlidersHorizontal,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';

import { User } from 'lucide-react';
import { search as searchApi } from '@/lib/api';
import { FileGrid } from '@/components/file-grid';
import { FolderCards } from '@/components/folder-cards';
import { EmptyState } from '@/components/empty-state';
import { SearchFilterBar, type SearchFilters } from '@/components/search-filter-bar';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
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

/** Known URL param prefixes for dynamic meta fields: `mf_<key>=val1,val2` */
const META_FIELD_PREFIX = 'mf_';

function parseFiltersFromParams(params: URLSearchParams): SearchFilters {
  // Parse dynamic metadata field filters from `mf_<key>` params
  const metaFields: Record<string, string[]> = {};
  params.forEach((value, key) => {
    if (key.startsWith(META_FIELD_PREFIX)) {
      const fieldKey = key.slice(META_FIELD_PREFIX.length);
      metaFields[fieldKey] = value.split(',').filter(Boolean);
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
  // Dynamic meta field filters
  for (const [key, vals] of Object.entries(filters.metaFields)) {
    if (vals.length > 0) p.set(`${META_FIELD_PREFIX}${key}`, vals.join(','));
  }
  if (sort && sort !== 'relevance') p.set('sort', sort);
  if (order && order !== 'desc') p.set('order', order);
  if (page > 1) p.set('page', String(page));
  return p;
}

/**
 * Extract people names and adult content from the dynamic metaFields
 * so the API can handle them as first-class filters (they have
 * dedicated JSONB query paths in the repository).
 */
function buildSearchParams(
  q: string,
  filters: SearchFilters,
  sort: string,
  order: string,
  page: number,
  limit: number,
): SearchParams & { includeFacets: boolean } {
  // People and adult_content are "well-known" meta field keys that
  // map to dedicated API filter params for efficient JSONB querying.
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
    page,
    limit,
    includeFacets: true,
  };
}

// ─── Main content ─────────────────────────────────────────────────────────────

function SearchContent() {
  const router = useRouter();
  const params = useSearchParams();

  // Parse initial state from URL
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

  // Only log a search after the user stops typing for 2 seconds.
  // This prevents logging every keystroke (n, na, nak, nake, naked).
  // Filter/sort/page changes set it immediately since those are
  // intentional discrete actions, not intermediate keystrokes.
  const [shouldLog, setShouldLog] = useState(false);
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Determine if we should search (need either a query or at least one filter)
  const hasQuery = query.trim().length > 0;
  const hasMetaFilters = Object.values(filters.metaFields).some((v) => v.length > 0);
  const hasFilters = !!(
    filters.tags.length || filters.mimeTypes.length ||
    filters.archiveRootIds.length || hasMetaFilters ||
    filters.hasFaces || filters.dateFrom || filters.dateTo ||
    filters.ratingMin !== undefined || filters.ratingMax !== undefined
  );
  const shouldSearch = hasQuery || hasFilters;

  // URL sync — push changes to the URL on every state change.
  useEffect(() => {
    const p = filtersToParams(query, filters, sort, order, page);
    const newSearch = p.toString();
    const currentSearch = window.location.search.replace(/^\?/, '');
    if (newSearch !== currentSearch) {
      router.replace(`/search${newSearch ? `?${newSearch}` : ''}`, { scroll: false });
    }
  }, [query, filters, sort, order, page, router]);

  // Browse context for the lightbox
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
  });

  // Reset shouldLog after it's been consumed so it doesn't re-log
  // on subsequent cache-hit re-renders.
  useEffect(() => {
    if (shouldLog && data) setShouldLog(false);
  }, [shouldLog, data]);

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const total = data?.total ?? 0;
  const facets = data?.facets;
  const hasMore = data?.hasMore ?? false;
  const isEmpty = shouldSearch && !isLoading && files.length === 0 && folders.length === 0;

  // Set browse context for lightbox
  useEffect(() => {
    if (files.length > 0) {
      setBrowseContext('Search results', files);
    }
    return () => clearBrowseContext();
  }, [files, setBrowseContext, clearBrowseContext]);

  // Reset page when query or filters change.
  // Query changes use a 2s debounce before enabling logging.
  // Filter changes log immediately (intentional discrete actions).
  const handleQueryChange = useCallback((newQ: string) => {
    setQuery(newQ);
    setPage(1);
    setShouldLog(false); // Don't log intermediate keystrokes
    if (logTimerRef.current) clearTimeout(logTimerRef.current);
    logTimerRef.current = setTimeout(() => setShouldLog(true), 2000);
  }, []);

  const handleFiltersChange = useCallback((newFilters: SearchFilters) => {
    setFilters(newFilters);
    setPage(1);
    setShouldLog(true); // Filter changes are intentional — log immediately
  }, []);

  return (
    <div className="flex flex-col">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-border">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search files, tags, people, metadata…"
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Search"
            />
            {isFetching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Sort */}
          <select
            value={`${sort}-${order}`}
            onChange={(e) => {
              const [s, o] = e.target.value.split('-');
              setSort(s);
              setOrder(o);
            }}
            className="hidden sm:block h-10 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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

        {/* People quick-select — horizontal avatar strip */}
        <PeopleAvatarStrip
          selectedPeople={filters.metaFields['people'] ?? []}
          onToggle={(name) => {
            const current = filters.metaFields['people'] ?? [];
            const next = current.includes(name)
              ? current.filter((n) => n !== name)
              : [...current, name];
            handleFiltersChange({
              ...filters,
              metaFields: { ...filters.metaFields, people: next },
            });
          }}
        />

        {/* Filter bar */}
        <div className="px-4 pb-3">
          <SearchFilterBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            facets={facets ? {
              tags: facets.tags,
              people: facets.people,
              mimeTypes: facets.mimeTypes,
            } : undefined}
          />
        </div>

        {/* Result count */}
        {shouldSearch && !isLoading && (
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
            {query && <> for &ldquo;{query}&rdquo;</>}
          </div>
        )}
      </div>

      {/* ── Results ─────────────────────────────────────────────── */}
      <div className="flex-1 p-4">
        {!shouldSearch && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-muted p-4">
              <SearchIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Search Harbor</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Search across all your files, metadata, tags, and people.
              Use the filters above to narrow results.
            </p>
          </div>
        )}

        {isLoading && shouldSearch && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isEmpty && (
          <EmptyState
            icon={SearchIcon}
            title="No results"
            description={`Nothing matched${query ? ` "${query}"` : ''} with the current filters. Try broadening your search.`}
          />
        )}

        {!isLoading && !isEmpty && shouldSearch && (
          <div className="space-y-6">
            {folders.length > 0 && (
              <section aria-label="Matching folders">
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Folders ({folders.length})
                </h2>
                <FolderCards folders={folders} />
              </section>
            )}
            {files.length > 0 && (
              <section aria-label="Matching files">
                {folders.length > 0 && (
                  <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Files ({data?.total ?? files.length})
                  </h2>
                )}
                <FileGrid files={files} />
              </section>
            )}

            {/* Pagination */}
            {(hasMore || page > 1) && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {page}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
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

/**
 * Horizontal avatar strip — shows known people as clickable circles.
 * Clicking a person toggles them as a search filter. Selected people
 * get a ring highlight. This gives users a visual, one-tap way to
 * filter by person without opening the filter popover.
 */
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
        id: string;
        name: string | null;
        avatarUrl: string | null;
        faceCount: number;
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
              isSelected
                ? 'bg-primary/10'
                : 'hover:bg-accent',
            )}
          >
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 transition',
                isSelected
                  ? 'border-primary shadow-md shadow-primary/20'
                  : 'border-transparent group-hover:border-border',
              )}
            >
              {person.avatarUrl ? (
                <img
                  src={person.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
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
