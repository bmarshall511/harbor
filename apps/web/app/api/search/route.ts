import { NextResponse } from 'next/server';
import { SearchRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { serializeFile } from '@/lib/file-dto';

const searchRepo = new SearchRepository();

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      query = '',
      archiveRootIds,
      folderIds,
      mimeTypes,
      tags,
      people,
      personId,
      adultContent,
      hasFaces,
      dateFrom,
      dateTo,
      ratingMin,
      ratingMax,
      sortBy,
      sortOrder,
      page = 1,
      limit = 50,
      includeFacets = false,
    } = body;

    // Allow empty-query searches when filters are provided (browse mode).
    const hasQuery = query.length > 0;
    const hasFilters = !!(
      archiveRootIds?.length || folderIds?.length || mimeTypes?.length ||
      tags?.length || people?.length || personId || adultContent?.length ||
      hasFaces || dateFrom || dateTo ||
      ratingMin !== undefined || ratingMax !== undefined
    );

    if (!hasQuery && !hasFilters) {
      return NextResponse.json({ message: 'Query or at least one filter is required' }, { status: 400 });
    }

    const start = Date.now();

    const searchOpts = {
      query,
      archiveRootIds,
      folderIds,
      mimeTypes,
      tags,
      people,
      personId,
      adultContent,
      hasFaces,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      ratingMin,
      ratingMax,
      sortBy,
      sortOrder,
      limit,
      offset: (page - 1) * limit,
    };

    const [fileResults, folderResults, facets] = await Promise.all([
      searchRepo.searchFiles(searchOpts),
      hasQuery ? searchRepo.searchFolders({ query, archiveRootIds, limit: 10 }) : Promise.resolve({ folders: [], total: 0 }),
      includeFacets ? searchRepo.getFacets(searchOpts) : Promise.resolve(undefined),
    ]);

    const durationMs = Date.now() - start;

    // Only log searches explicitly marked as "intentional" by the
    // client (Enter key, filter change, or after a typing debounce).
    // Live-as-you-type queries pass logSearch=false to avoid logging
    // every keystroke like "n", "na", "nak", "nake", "naked".
    if (body.logSearch) {
      const filters: Record<string, unknown> = {};
      if (archiveRootIds?.length) filters.archiveRootIds = archiveRootIds;
      if (mimeTypes?.length) filters.mimeTypes = mimeTypes;
      if (tags?.length) filters.tags = tags;
      if (people?.length) filters.people = people;
      if (personId) filters.personId = personId;
      if (adultContent?.length) filters.adultContent = adultContent;
      if (hasFaces) filters.hasFaces = true;
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (ratingMin !== undefined) filters.ratingMin = ratingMin;
      if (ratingMax !== undefined) filters.ratingMax = ratingMax;

      searchRepo
        .logSearch(auth.userId, query, filters, fileResults.total, durationMs)
        .catch((err) => console.error('[Search] Failed to log search:', err));
    }

    return NextResponse.json({
      files: fileResults.files.map((f) => serializeFile(f)),
      folders: folderResults.folders.map((f) => ({
        id: f.id,
        archiveRootId: f.archiveRootId,
        parentId: f.parentId,
        name: f.name,
        path: f.path,
        depth: f.depth,
        tags: f.tags.map((t) => ({
          id: t.tag.id,
          name: t.tag.name,
          color: t.tag.color,
          category: t.tag.category,
          usageCount: t.tag.usageCount,
        })),
        childCount: f._count.children,
        fileCount: f._count.files,
      })),
      total: fileResults.total + folderResults.total,
      page,
      limit,
      hasMore: fileResults.total > page * limit,
      ...(facets ? { facets } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
