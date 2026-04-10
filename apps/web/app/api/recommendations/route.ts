import { NextResponse } from 'next/server';
import { db, Prisma } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { applyIgnoreFilter } from '@/lib/file-filters';
import { serializeFile } from '@/lib/file-dto';

/**
 * POST /api/recommendations
 *
 * Content recommendation engine that combines multiple behavioural
 * signals to surface files the user is likely interested in.
 *
 * Signal sources (in order of weight):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ BROWSING BEHAVIOUR                                         │
 *   │ 1. Directories visited (past 48h)           +3.0 per dir   │
 *   │    — weighted by visit count in the window                 │
 *   │ 2. Same folder as a seed file               +3.0           │
 *   │ 3. Same archive root as a seed              +0.5           │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ FAVORITES                                                  │
 *   │ 4. Tags shared with recent favorites        +2.5 per tag   │
 *   │    — ordered by recency of the favorite                    │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ COLLECTIONS                                                │
 *   │ 5. Tags shared with items in recently-       +2.0 per tag  │
 *   │    updated collections                                     │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ SEARCH HISTORY                                             │
 *   │ 6. Files matching the user's recent           +2.0         │
 *   │    search queries (last 48h, top 5)                        │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ CONTENT SIGNALS                                            │
 *   │ 7. Shared tags with seed files              +2.0 per tag   │
 *   │ 8. Shared custom metadata values            +2.0 per atom  │
 *   │ 9. "This day in history" (same MM-DD)       +2.5           │
 *   │ 10. Same creation year as a seed            +1.0           │
 *   │ 11. Rating ≥ 4 multiplier                   ×1.25          │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Body: { seedIds?: string[], scope?: { archiveRootId?, folderId? }, limit?: number }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const seedIds: string[] = Array.isArray(body.seedIds) ? body.seedIds.slice(0, 50) : [];
  const limit = Math.min(48, Math.max(1, Number(body.limit) || 12));
  const scope = (body.scope ?? {}) as { archiveRootId?: string; folderId?: string };

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // ── Gather behavioural signals in parallel ─────────────────────

  const [
    seeds,
    directorySignals,
    favoriteTagSignals,
    collectionTagSignals,
    searchSignals,
  ] = await Promise.all([
    // Load seed files
    seedIds.length > 0
      ? db.file.findMany({
          where: { id: { in: seedIds }, status: { notIn: ['DELETED', 'PENDING_DELETE'] } },
          select: {
            id: true,
            folderId: true,
            archiveRootId: true,
            fileCreatedAt: true,
            tags: { select: { tag: { select: { id: true, name: true } } } },
            meta: true,
          },
        })
      : Promise.resolve([]),

    // 1. Directories visited in past 48h (from RecentView)
    db.$queryRaw<Array<{ folder_id: string; visit_count: bigint }>>(Prisma.sql`
      SELECT f.folder_id, COUNT(*)::bigint AS visit_count
      FROM recent_views rv
      JOIN files f ON f.id = rv.file_id
      WHERE rv.user_id = ${auth.userId}::uuid
        AND rv.viewed_at >= ${fortyEightHoursAgo}::timestamp
        AND f.folder_id IS NOT NULL
      GROUP BY f.folder_id
      ORDER BY visit_count DESC
      LIMIT 20
    `).catch(() => []),

    // 4. Tags from recent favorites
    db.$queryRaw<Array<{ tag_id: string; tag_name: string }>>(Prisma.sql`
      SELECT DISTINCT t.id AS tag_id, t.name AS tag_name
      FROM favorites fav
      JOIN file_tags ft ON ft.file_id = fav.entity_id
      JOIN tags t ON t.id = ft.tag_id
      WHERE fav.user_id = ${auth.userId}::uuid
        AND fav.entity_type = 'FILE'
      ORDER BY t.name
      LIMIT 30
    `).catch(() => []),

    // 5. Tags from items in recently-updated collections
    db.$queryRaw<Array<{ tag_id: string; tag_name: string }>>(Prisma.sql`
      SELECT DISTINCT t.id AS tag_id, t.name AS tag_name
      FROM collections c
      JOIN collection_items ci ON ci.collection_id = c.id
      JOIN file_tags ft ON ft.file_id = ci.entity_id AND ci.entity_type = 'FILE'
      JOIN tags t ON t.id = ft.tag_id
      WHERE c.user_id = ${auth.userId}::uuid
      ORDER BY t.name
      LIMIT 30
    `).catch(() => []),

    // 6. Recent search queries (last 48h)
    db.searchLog.findMany({
      where: {
        userId: auth.userId,
        createdAt: { gte: fortyEightHoursAgo },
        query: { not: '' },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { query: true },
    }),
  ]);

  // ── Aggregate signals ──────────────────────────────────────────

  const seedFolders = new Set<string>();
  const seedRoots = new Set<string>();
  const seedYears = new Set<number>();
  const seedTagIds = new Set<string>();
  const seedMetaAtoms = new Map<string, { key: string; label: string }>();

  for (const s of seeds) {
    if (s.folderId) seedFolders.add(s.folderId);
    seedRoots.add(s.archiveRootId);
    if (s.fileCreatedAt) seedYears.add(s.fileCreatedAt.getFullYear());
    for (const t of s.tags) seedTagIds.add(t.tag.id);
    for (const atom of metaAtomsFromMeta(s.meta)) {
      seedMetaAtoms.set(atom.matchKey, { key: atom.key, label: atom.label });
    }
  }

  // Browsing directories (weighted by visit frequency)
  const visitedFolderWeights = new Map<string, number>();
  for (const row of directorySignals) {
    visitedFolderWeights.set(row.folder_id, Number(row.visit_count));
  }

  // Favorite + collection tag affinity sets
  const favoriteTagIds = new Set(favoriteTagSignals.map((r) => r.tag_id));
  const collectionTagIds = new Set(collectionTagSignals.map((r) => r.tag_id));

  // Search queries for FTS matching
  const recentQueries = [...new Set(searchSignals.map((s) => s.query))];

  // ── Build candidate pool ───────────────────────────────────────

  const candidateOrConditions: Prisma.FileWhereInput[] = [];

  // Seed-based signals
  if (seedFolders.size > 0) candidateOrConditions.push({ folderId: { in: [...seedFolders] } });
  if (seedTagIds.size > 0) candidateOrConditions.push({ tags: { some: { tagId: { in: [...seedTagIds] } } } });
  if (seedRoots.size > 0) candidateOrConditions.push({ archiveRootId: { in: [...seedRoots] } });

  // Directory visit signals
  const visitedFolderIds = [...visitedFolderWeights.keys()];
  if (visitedFolderIds.length > 0) candidateOrConditions.push({ folderId: { in: visitedFolderIds } });

  // Favorite + collection tag signals
  const affinityTagIds = [...new Set([...favoriteTagIds, ...collectionTagIds])];
  if (affinityTagIds.length > 0) candidateOrConditions.push({ tags: { some: { tagId: { in: affinityTagIds } } } });

  // If no signals at all, use discover mode
  if (candidateOrConditions.length === 0 && recentQueries.length === 0) {
    return discoverMode(auth.userId, scope, limit, todayMonth, todayDay);
  }

  const candidates = await db.file.findMany({
    where: {
      id: { notIn: seedIds },
      status: { notIn: ['DELETED', 'PENDING_DELETE'] },
      ...(scope.archiveRootId ? { archiveRootId: scope.archiveRootId } : {}),
      ...(scope.folderId ? { folderId: scope.folderId } : {}),
      OR: [{ mimeType: { startsWith: 'image/' } }, { mimeType: { startsWith: 'video/' } }],
      ...(candidateOrConditions.length > 0 ? { AND: { OR: candidateOrConditions } } : {}),
    },
    include: {
      tags: { include: { tag: true } },
      previews: { where: { size: 'THUMBNAIL' } },
    },
    take: 800,
  });

  // Search-matched candidates (FTS on recent queries)
  const searchMatchedIds = new Set<string>();
  if (recentQueries.length > 0) {
    for (const q of recentQueries.slice(0, 3)) {
      const words = q.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const tsq = words.map((w) => w.replace(/[^\w]/g, '')).filter(Boolean).join(' & ');
      if (!tsq) continue;
      try {
        const hits = await db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM files
           WHERE search_vector @@ to_tsquery('english', $1)
             AND status NOT IN ('DELETED', 'PENDING_DELETE')
             AND id != ALL($2::uuid[])
           LIMIT 30`,
          tsq,
          seedIds,
        );
        for (const h of hits) searchMatchedIds.add(h.id);
      } catch { /* query parse error — skip */ }
    }
  }

  // "This day in history" supplement
  const scopeClause = scope.archiveRootId
    ? Prisma.sql`AND archive_root_id = ${scope.archiveRootId}::uuid`
    : scope.folderId
      ? Prisma.sql`AND folder_id = ${scope.folderId}::uuid`
      : Prisma.empty;

  const onThisDayRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id::text AS id FROM files
    WHERE status NOT IN ('DELETED', 'PENDING_DELETE')
      AND file_created_at IS NOT NULL
      AND EXTRACT(MONTH FROM file_created_at) = ${todayMonth}
      AND EXTRACT(DAY FROM file_created_at) = ${todayDay}
      AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
      ${scopeClause}
    LIMIT 100
  `).catch(() => []);

  const haveIds = new Set(candidates.map((c) => c.id));
  const extraIds = [
    ...onThisDayRows.map((r) => r.id),
    ...searchMatchedIds,
  ].filter((id) => !haveIds.has(id) && !seedIds.includes(id));

  if (extraIds.length > 0) {
    const extra = await db.file.findMany({
      where: { id: { in: [...new Set(extraIds)] } },
      include: {
        tags: { include: { tag: true } },
        previews: { where: { size: 'THUMBNAIL' } },
      },
    });
    candidates.push(...extra);
  }

  // ── Score each candidate ───────────────────────────────────────

  type Scored = { file: (typeof candidates)[number]; score: number; reasons: string[] };
  const scored: Scored[] = [];

  for (const c of candidates) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Directory visited in past 48h
    if (c.folderId) {
      const visits = visitedFolderWeights.get(c.folderId);
      if (visits) {
        score += 3.0 * Math.min(visits, 5); // cap weight at 5 visits
        reasons.push('From a directory you have been browsing');
      }
    }

    // 2. Same folder as a seed
    if (c.folderId && seedFolders.has(c.folderId) && !visitedFolderWeights.has(c.folderId)) {
      score += 3.0;
      reasons.push('From a related folder');
    }

    // 3. Same archive root
    if (seedRoots.has(c.archiveRootId)) score += 0.5;

    // 4+5. Tag affinity from favorites and collections
    let favTagHits = 0;
    let colTagHits = 0;
    const affinityTagNames: string[] = [];
    for (const t of c.tags) {
      if (favoriteTagIds.has(t.tag.id)) {
        favTagHits++;
        affinityTagNames.push(t.tag.name);
      }
      if (collectionTagIds.has(t.tag.id)) {
        colTagHits++;
        if (!affinityTagNames.includes(t.tag.name)) affinityTagNames.push(t.tag.name);
      }
    }
    if (favTagHits > 0) {
      score += 2.5 * favTagHits;
      reasons.push(
        favTagHits === 1
          ? `Shares tag "${affinityTagNames[0]}" with your favorites`
          : `${favTagHits} tags in common with your favorites`,
      );
    }
    if (colTagHits > 0) {
      score += 2.0 * colTagHits;
      if (favTagHits === 0) {
        reasons.push(`${colTagHits} tags in common with your collections`);
      }
    }

    // 6. Search history match
    if (searchMatchedIds.has(c.id)) {
      score += 2.0;
      reasons.push('Matches your recent searches');
    }

    // 7. Shared tags with seeds
    let sharedTagCount = 0;
    const sharedTagNames: string[] = [];
    for (const t of c.tags) {
      if (seedTagIds.has(t.tag.id)) {
        sharedTagCount++;
        sharedTagNames.push(t.tag.name);
      }
    }
    if (sharedTagCount > 0) {
      score += 2.0 * sharedTagCount;
      if (favTagHits === 0 && colTagHits === 0) {
        reasons.push(
          sharedTagCount === 1
            ? `Tagged "${sharedTagNames[0]}"`
            : `Shares ${sharedTagCount} tags with your activity`,
        );
      }
    }

    // 8. Shared custom metadata
    let metaMatches = 0;
    const atomLabels = new Set<string>();
    for (const atom of metaAtomsFromMeta((c as { meta?: unknown }).meta)) {
      if (seedMetaAtoms.has(atom.matchKey)) {
        metaMatches++;
        atomLabels.add(seedMetaAtoms.get(atom.matchKey)!.label);
      }
    }
    if (metaMatches > 0) {
      score += 2.0 * metaMatches;
      const labels = [...atomLabels];
      if (labels.length === 1) reasons.push(`Also tagged ${labels[0]}`);
      else if (labels.length > 1) reasons.push(`Shares ${labels.length} details with your activity`);
    }

    // 9. This day in history
    if (isSameMonthDay(c.fileCreatedAt, todayMonth, todayDay)) {
      score += 2.5;
      reasons.unshift(`On this day, ${c.fileCreatedAt!.getFullYear()}`);
    }

    // 10. Same year
    if (c.fileCreatedAt && seedYears.has(c.fileCreatedAt.getFullYear())) score += 1.0;

    // 11. Rating boost
    if (c.rating != null && c.rating >= 4) score *= 1.25;

    if (score > 0) scored.push({ file: c, score, reasons });
  }

  // ── Filter, sort, respond ──────────────────────────────────────

  const filteredFiles = await applyIgnoreFilter(scored.map((s) => s.file));
  const allowedIds = new Set(filteredFiles.map((f) => f.id));
  const filtered = scored.filter((s) => allowedIds.has(s.file.id));
  filtered.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    items: filtered.slice(0, limit).map((s) => ({
      file: serializeFile(s.file),
      score: Number(s.score.toFixed(2)),
      reasons: s.reasons.slice(0, 3),
    })),
  });
}

// ─── Discover mode (no seeds) ─────────────────────────────────────────────────

async function discoverMode(
  userId: string,
  scope: { archiveRootId?: string; folderId?: string },
  limit: number,
  todayMonth: number,
  todayDay: number,
) {
  const fallback = await db.file.findMany({
    where: {
      status: { notIn: ['DELETED', 'PENDING_DELETE'] },
      ...(scope.archiveRootId ? { archiveRootId: scope.archiveRootId } : {}),
      ...(scope.folderId ? { folderId: scope.folderId } : {}),
      OR: [{ mimeType: { startsWith: 'image/' } }, { mimeType: { startsWith: 'video/' } }],
    },
    include: {
      tags: { include: { tag: true } },
      previews: { where: { size: 'THUMBNAIL' } },
    },
    orderBy: [{ rating: 'desc' }, { fileCreatedAt: 'desc' }],
    take: limit * 4,
  });
  const filtered = await applyIgnoreFilter(fallback);

  const ranked = filtered.map((f) => {
    const isToday = isSameMonthDay(f.fileCreatedAt, todayMonth, todayDay);
    return {
      file: f,
      score: isToday ? 5 : 1,
      reasons: [isToday ? `On this day, ${f.fileCreatedAt!.getFullYear()}` : 'Highly rated in your library'],
    };
  });
  ranked.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    items: ranked.slice(0, limit).map((s) => ({
      file: serializeFile(s.file),
      score: s.score,
      reasons: s.reasons,
    })),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSameMonthDay(d: Date | null, month: number, day: number): boolean {
  if (!d) return false;
  return d.getMonth() + 1 === month && d.getDate() === day;
}

function metaAtomsFromMeta(meta: unknown): Array<{ key: string; matchKey: string; label: string }> {
  if (!meta || typeof meta !== 'object') return [];
  const m = meta as { core?: Record<string, unknown>; fields?: Record<string, unknown> };
  const out: Array<{ key: string; matchKey: string; label: string }> = [];

  function push(key: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    out.push({ key, matchKey: `${key}::${trimmed.toLowerCase()}`, label: trimmed });
  }

  function walk(key: string, value: unknown) {
    if (value == null) return;
    if (typeof value === 'string') return push(key, value);
    if (typeof value === 'number' || typeof value === 'boolean') return push(key, String(value));
    if (Array.isArray(value)) {
      for (const item of value) walk(key, item);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj.kind === 'user' && typeof obj.id === 'string') {
        const label = typeof obj.name === 'string' ? obj.name : String(obj.id);
        out.push({ key, matchKey: `${key}::user:${obj.id}`, label });
        return;
      }
      if (typeof obj.name === 'string') push(key, obj.name);
    }
  }

  for (const [k, v] of Object.entries(m.fields ?? {})) walk(k, v);
  return out;
}
