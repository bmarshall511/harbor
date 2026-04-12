import { db } from '../client';
import type { Prisma } from '../../generated/prisma/client';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface SearchOptions {
  query: string;
  archiveRootIds?: string[];
  folderIds?: string[];
  mimeTypes?: string[];
  /** Tag names (matched via file_tags join). */
  tags?: string[];
  /** People names (matched against meta.fields.people[].name JSONB). */
  people?: string[];
  /** Face→Person UUID — files where at least one detected face belongs to this Person. */
  personId?: string;
  /** Adult content labels to include (matched against meta.fields.adult_content). */
  adultContent?: string[];
  /** true = only files that have at least one detected face row. */
  hasFaces?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  ratingMin?: number;
  ratingMax?: number;
  status?: string[];
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'name' | 'date' | 'size' | 'rating';
  sortOrder?: 'asc' | 'desc';
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class SearchRepository {
  /**
   * Search files using the materialized `search_vector` tsvector column
   * (populated by the `file_search_vector_update` trigger) plus trigram
   * matching on `name` for partial/fuzzy hits. Falls back to ILIKE if
   * the tsquery fails to parse.
   */
  async searchFiles(options: SearchOptions) {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const words = options.query.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 && !this.hasNonQueryFilters(options)) {
      return { files: [], total: 0 };
    }

    const conditions: string[] = ["f.status NOT IN ('DELETED', 'PENDING_DELETE')"];
    const params: unknown[] = [];
    let pi = 1; // param index

    // ── Full-text + trigram match ──────────────────────────────────
    if (words.length > 0) {
      const tsQuery = words
        .map((w) => w.replace(/[^\w\-]/g, ''))
        .filter(Boolean)
        .join(' & ');

      conditions.push(`(
        f.search_vector @@ to_tsquery('english', $${pi})
        OR f.name ILIKE $${pi + 1}
        OR f.name % $${pi + 2}
      )`);
      params.push(tsQuery, `%${options.query}%`, options.query);
      pi += 3;
    }

    // ── Archive root filter ───────────────────────────────────────
    if (options.archiveRootIds?.length) {
      conditions.push(`f.archive_root_id = ANY($${pi}::uuid[])`);
      params.push(options.archiveRootIds);
      pi++;
    }

    // ── Folder filter ─────────────────────────────────────────────
    if (options.folderIds?.length) {
      conditions.push(`f.folder_id = ANY($${pi}::uuid[])`);
      params.push(options.folderIds);
      pi++;
    }

    // ── MIME type filter ──────────────────────────────────────────
    if (options.mimeTypes?.length) {
      // Support both exact types ("image/jpeg") and prefixes ("image")
      const exact = options.mimeTypes.filter((m) => m.includes('/'));
      const prefixes = options.mimeTypes.filter((m) => !m.includes('/'));
      const mimeConds: string[] = [];
      if (exact.length) {
        mimeConds.push(`f.mime_type = ANY($${pi}::text[])`);
        params.push(exact);
        pi++;
      }
      for (const prefix of prefixes) {
        mimeConds.push(`f.mime_type LIKE $${pi}::text`);
        params.push(`${prefix}/%`);
        pi++;
      }
      if (mimeConds.length) {
        conditions.push(`(${mimeConds.join(' OR ')})`);
      }
    }

    // ── Tag filter (by name) ──────────────────────────────────────
    if (options.tags?.length) {
      conditions.push(`EXISTS (
        SELECT 1 FROM file_tags ft
        JOIN tags t ON t.id = ft.tag_id
        WHERE ft.file_id = f.id AND t.name = ANY($${pi}::text[])
      )`);
      params.push(options.tags);
      pi++;
    }

    // ── People filter (metadata-based) ────────────────────────────
    if (options.people?.length) {
      // Match any file where meta.fields.people array contains an
      // element whose "name" matches one of the requested names.
      // We use a lateral join to explode the array and match.
      conditions.push(`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(f.meta -> 'fields' -> 'people', '[]'::jsonb)) AS elem
        WHERE elem ->> 'name' = ANY($${pi}::text[])
      )`);
      params.push(options.people);
      pi++;
    }

    // ── Person ID filter (face-detection-based) ───────────────────
    if (options.personId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM faces fc WHERE fc.file_id = f.id AND fc.person_id = $${pi}::uuid
      )`);
      params.push(options.personId);
      pi++;
    }

    // ── Has faces filter ──────────────────────────────────────────
    if (options.hasFaces) {
      conditions.push(`EXISTS (SELECT 1 FROM faces fc WHERE fc.file_id = f.id)`);
    }

    // ── Adult content filter ──────────────────────────────────────
    if (options.adultContent?.length) {
      // Match files where meta.fields.adult_content array overlaps
      // with any of the requested labels.
      conditions.push(`EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(f.meta -> 'fields' -> 'adult_content', '[]'::jsonb)) AS ac
        WHERE ac = ANY($${pi}::text[])
      )`);
      params.push(options.adultContent);
      pi++;
    }

    // ── Date range ────────────────────────────────────────────────
    if (options.dateFrom) {
      conditions.push(`f.file_created_at >= $${pi}::timestamp`);
      params.push(options.dateFrom);
      pi++;
    }
    if (options.dateTo) {
      conditions.push(`f.file_created_at <= $${pi}::timestamp`);
      params.push(options.dateTo);
      pi++;
    }

    // ── Rating range ──────────────────────────────────────────────
    if (options.ratingMin !== undefined) {
      conditions.push(`f.rating >= $${pi}::int`);
      params.push(options.ratingMin);
      pi++;
    }
    if (options.ratingMax !== undefined) {
      conditions.push(`f.rating <= $${pi}::int`);
      params.push(options.ratingMax);
      pi++;
    }

    const whereClause = conditions.join(' AND ');

    // ── Sort ──────────────────────────────────────────────────────
    let orderClause: string;
    if (words.length > 0 && (options.sortBy === 'relevance' || !options.sortBy)) {
      orderClause = `ts_rank(f.search_vector, to_tsquery('english', $1)) DESC, f.name ASC`;
    } else if (options.sortBy === 'name') {
      orderClause = `f.name ${options.sortOrder ?? 'ASC'}`;
    } else if (options.sortBy === 'date') {
      orderClause = `f.file_created_at ${options.sortOrder ?? 'DESC'} NULLS LAST`;
    } else if (options.sortBy === 'size') {
      orderClause = `f.size ${options.sortOrder ?? 'DESC'}`;
    } else if (options.sortBy === 'rating') {
      orderClause = `f.rating ${options.sortOrder ?? 'DESC'} NULLS LAST`;
    } else {
      orderClause = 'f.name ASC';
    }

    try {
      const [countResult, idResult] = await Promise.all([
        db.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT count(*)::bigint as count FROM files f WHERE ${whereClause}`,
          ...params,
        ),
        db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT f.id FROM files f WHERE ${whereClause} ORDER BY ${orderClause} LIMIT ${limit} OFFSET ${offset}`,
          ...params,
        ),
      ]);

      const total = Number(countResult[0]?.count ?? 0);
      if (idResult.length === 0) return { files: [], total };

      const fileIds = idResult.map((r) => r.id);
      const files = await db.file.findMany({
        where: { id: { in: fileIds } },
        include: {
          tags: { include: { tag: true } },
          previews: { where: { size: 'THUMBNAIL' } },
          folder: { select: { id: true, name: true, path: true } },
        },
      });

      // Preserve rank order from the raw query
      const fileMap = new Map(files.map((f) => [f.id, f]));
      const ordered = fileIds.map((id) => fileMap.get(id)).filter(Boolean);

      return { files: ordered as typeof files, total };
    } catch (error) {
      console.warn('FTS query failed, falling back to ILIKE:', error);
      return this.searchFilesIlike(options);
    }
  }

  /**
   * Faceted counts for the current search query. Runs lightweight
   * aggregate queries against the same WHERE clause so the filter bar
   * can show how many results each facet would return.
   */
  async getFacets(options: SearchOptions) {
    const words = options.query.trim().split(/\s+/).filter(Boolean);

    // Build the same WHERE clause as searchFiles, but without pagination
    const conditions: string[] = ["f.status NOT IN ('DELETED', 'PENDING_DELETE')"];
    const params: unknown[] = [];
    let pi = 1;

    if (words.length > 0) {
      const tsQuery = words.map((w) => w.replace(/[^\w\-]/g, '')).filter(Boolean).join(' & ');
      conditions.push(`(f.search_vector @@ to_tsquery('english', $${pi}) OR f.name ILIKE $${pi + 1})`);
      params.push(tsQuery, `%${options.query}%`);
      pi += 2;
    }
    if (options.archiveRootIds?.length) {
      conditions.push(`f.archive_root_id = ANY($${pi}::uuid[])`);
      params.push(options.archiveRootIds);
      pi++;
    }

    const where = conditions.join(' AND ');

    try {
      const [mimeTypes, tagFacets, peopleFacets, personFacets, ratingDist, totalFiles, totalFolders] = await Promise.all([
        // MIME type counts
        db.$queryRawUnsafe<Array<{ value: string; count: bigint }>>(
          `SELECT f.mime_type AS value, count(*)::bigint AS count
           FROM files f WHERE ${where} AND f.mime_type IS NOT NULL
           GROUP BY f.mime_type ORDER BY count DESC LIMIT 20`,
          ...params,
        ),
        // Tag counts
        db.$queryRawUnsafe<Array<{ id: string; name: string; color: string | null; count: bigint }>>(
          `SELECT t.id, t.name, t.color, count(*)::bigint AS count
           FROM files f
           JOIN file_tags ft ON ft.file_id = f.id
           JOIN tags t ON t.id = ft.tag_id
           WHERE ${where}
           GROUP BY t.id, t.name, t.color ORDER BY count DESC LIMIT 30`,
          ...params,
        ),
        // People counts (metadata-based)
        db.$queryRawUnsafe<Array<{ name: string; count: bigint }>>(
          `SELECT elem ->> 'name' AS name, count(DISTINCT f.id)::bigint AS count
           FROM files f,
                jsonb_array_elements(COALESCE(f.meta -> 'fields' -> 'people', '[]'::jsonb)) AS elem
           WHERE ${where} AND elem ->> 'name' IS NOT NULL
           GROUP BY elem ->> 'name' ORDER BY count DESC LIMIT 30`,
          ...params,
        ),
        // Person counts (face-detection-based)
        db.$queryRawUnsafe<Array<{ id: string; name: string; face_count: bigint }>>(
          `SELECT p.id, p.name, count(DISTINCT fc.file_id)::bigint AS face_count
           FROM files f
           JOIN faces fc ON fc.file_id = f.id
           JOIN persons p ON p.id = fc.person_id
           WHERE ${where} AND p.name IS NOT NULL
           GROUP BY p.id, p.name ORDER BY face_count DESC LIMIT 30`,
          ...params,
        ),
        // Rating distribution
        db.$queryRawUnsafe<Array<{ rating: number; count: bigint }>>(
          `SELECT f.rating, count(*)::bigint AS count
           FROM files f WHERE ${where} AND f.rating IS NOT NULL
           GROUP BY f.rating ORDER BY f.rating`,
          ...params,
        ),
        // Total files
        db.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT count(*)::bigint AS count FROM files f WHERE ${where}`,
          ...params,
        ),
        // Total folders (simple ILIKE on query if provided)
        words.length > 0
          ? db.folder.count({
              where: {
                OR: [
                  { name: { contains: options.query, mode: 'insensitive' } },
                  { description: { contains: options.query, mode: 'insensitive' } },
                ],
              },
            })
          : Promise.resolve(0),
      ]);

      return {
        mimeTypes: mimeTypes.map((r) => ({ value: r.value, count: Number(r.count) })),
        tags: tagFacets.map((r) => ({ id: r.id, name: r.name, color: r.color, count: Number(r.count) })),
        people: peopleFacets.map((r) => ({ name: r.name, count: Number(r.count) })),
        persons: personFacets.map((r) => ({ id: r.id, name: r.name, faceCount: Number(r.face_count) })),
        ratingDistribution: ratingDist.map((r) => ({ rating: r.rating, count: Number(r.count) })),
        totalFiles: Number(totalFiles[0]?.count ?? 0),
        totalFolders: typeof totalFolders === 'number' ? totalFolders : 0,
      };
    } catch (error) {
      console.warn('Facet query failed:', error);
      return {
        mimeTypes: [],
        tags: [],
        people: [],
        persons: [],
        ratingDistribution: [],
        totalFiles: 0,
        totalFolders: 0,
      };
    }
  }

  /**
   * Log a search for admin analytics.
   */
  async logSearch(userId: string, query: string, filters: Record<string, unknown>, resultCount: number, durationMs: number) {
    await db.searchLog.create({
      data: {
        userId,
        query,
        filters: filters as Prisma.JsonObject,
        resultCount,
        durationMs,
      },
    });
  }

  // ── Folder search (unchanged) ───────────────────────────────────

  async searchFolders(options: SearchOptions) {
    const where: Prisma.FolderWhereInput = {};

    if (options.query) {
      where.OR = [
        { name: { contains: options.query, mode: 'insensitive' } },
        { description: { contains: options.query, mode: 'insensitive' } },
        { location: { contains: options.query, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: options.query, mode: 'insensitive' } } } } },
      ];
    }

    if (options.archiveRootIds?.length) {
      where.archiveRootId = { in: options.archiveRootIds };
    }

    const [folders, total] = await Promise.all([
      db.folder.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          _count: { select: { children: true, files: true } },
        },
        orderBy: { name: 'asc' },
        take: options.limit ?? 20,
        skip: options.offset ?? 0,
      }),
      db.folder.count({ where }),
    ]);

    return { folders, total };
  }

  // ── Private helpers ─────────────────────────────────────────────

  private hasNonQueryFilters(options: SearchOptions): boolean {
    return !!(
      options.archiveRootIds?.length ||
      options.folderIds?.length ||
      options.mimeTypes?.length ||
      options.tags?.length ||
      options.people?.length ||
      options.personId ||
      options.adultContent?.length ||
      options.hasFaces ||
      options.dateFrom ||
      options.dateTo ||
      options.ratingMin !== undefined ||
      options.ratingMax !== undefined
    );
  }

  /** Fallback ILIKE search when tsquery parsing fails. */
  private async searchFilesIlike(options: SearchOptions) {
    const andConditions: Prisma.FileWhereInput[] = [
      { status: { notIn: ['DELETED', 'PENDING_DELETE'] } },
    ];

    if (options.query) {
      andConditions.push({
        OR: [
          { name: { contains: options.query, mode: 'insensitive' } },
          { title: { contains: options.query, mode: 'insensitive' } },
          { description: { contains: options.query, mode: 'insensitive' } },
          { tags: { some: { tag: { name: { contains: options.query, mode: 'insensitive' } } } } },
        ],
      });
    }

    if (options.archiveRootIds?.length) andConditions.push({ archiveRootId: { in: options.archiveRootIds } });
    if (options.folderIds?.length) andConditions.push({ folderId: { in: options.folderIds } });
    if (options.mimeTypes?.length) andConditions.push({ mimeType: { in: options.mimeTypes } });
    if (options.tags?.length) {
      andConditions.push({ tags: { some: { tag: { name: { in: options.tags } } } } });
    }
    if (options.dateFrom) andConditions.push({ fileCreatedAt: { gte: options.dateFrom } });
    if (options.dateTo) andConditions.push({ fileCreatedAt: { lte: options.dateTo } });
    if (options.ratingMin !== undefined) andConditions.push({ rating: { gte: options.ratingMin } });
    if (options.ratingMax !== undefined) andConditions.push({ rating: { lte: options.ratingMax } });

    // JSONB filters (adult content, people) — use Prisma's JSON path filtering.
    if (options.adultContent?.length) {
      // Match files where meta.fields.adult_content array contains any of the requested values.
      andConditions.push({
        OR: options.adultContent.map((label) => ({
          meta: { path: ['fields', 'adult_content'], array_contains: [label] },
        })),
      });
    }
    if (options.people?.length) {
      // Match files where meta.fields.people contains an element with a matching name.
      // Prisma doesn't support deep array-element matching, so use string_contains
      // on the serialized JSON as an approximation. The primary FTS path handles
      // this precisely; this is only a fallback.
      andConditions.push({
        OR: options.people.map((name) => ({
          meta: { path: ['fields', 'people'], string_contains: name },
        })),
      });
    }

    const where: Prisma.FileWhereInput = { AND: andConditions };

    const [files, total] = await Promise.all([
      db.file.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          previews: { where: { size: 'THUMBNAIL' } },
          folder: { select: { id: true, name: true, path: true } },
        },
        orderBy: { name: 'asc' },
        take: options.limit ?? 50,
        skip: options.offset ?? 0,
      }),
      db.file.count({ where }),
    ]);

    return { files, total };
  }
}
