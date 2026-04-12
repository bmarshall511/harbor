import { NextResponse } from 'next/server';
import { db, Prisma } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { applyIgnoreFilter } from '@/lib/file-filters';
import { serializeFile } from '@/lib/file-dto';

/**
 * GET /api/review
 *
 * Returns a prioritized queue of files that need human review.
 * Review state is tracked in `meta.system.reviewedAt` (JSON column).
 *
 * Priority scoring (higher = more urgent):
 *   +25  No title
 *   +15  No description
 *   +15  No manual tags
 *   +10  No people tagged
 *   +10  Has AI tags but no manual tags
 *   +20  Has unconfirmed faces detected
 *   +20  Never manually edited (no metadata edits)
 *   +1/day  Days since last update (capped at 30)
 *
 * Query params:
 *   cursor   - file ID for cursor-based pagination
 *   limit    - number of items (default 20, max 50)
 *   filter   - comma-separated: missing_title, missing_tags, missing_people,
 *              unconfirmed_faces, images, videos, audio, documents
 *   root     - archive root ID filter
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'review', 'access');
  if (denied) return denied;

  try {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const filterParam = url.searchParams.get('filter') ?? '';
  const rootFilter = url.searchParams.get('root');
  const folderFilter = url.searchParams.get('folder');
  const filters = new Set(filterParam.split(',').map((s) => s.trim()).filter(Boolean));

  // Build WHERE clause
  const where: Prisma.FileWhereInput = {
    status: { notIn: ['DELETED', 'PENDING_DELETE'] },
    ...(rootFilter ? { archiveRootId: rootFilter } : {}),
    ...(folderFilter ? await buildFolderFilter(folderFilter) : {}),
  };

  // Media type filters
  const mimeFilters: Prisma.FileWhereInput[] = [];
  if (filters.has('images')) mimeFilters.push({ mimeType: { startsWith: 'image/' } });
  if (filters.has('videos')) mimeFilters.push({ mimeType: { startsWith: 'video/' } });
  if (filters.has('audio')) mimeFilters.push({ mimeType: { startsWith: 'audio/' } });
  if (filters.has('documents')) mimeFilters.push({
    mimeType: { in: ['application/pdf', 'text/plain', 'application/json', 'text/markdown'] },
  });
  if (mimeFilters.length > 0) where.OR = mimeFilters;

  // Content-based filters applied in scoring below
  const requireMissingTitle = filters.has('missing_title');
  const requireMissingTags = filters.has('missing_tags');
  const requireMissingPeople = filters.has('missing_people');
  const requireUnconfirmedFaces = filters.has('unconfirmed_faces');

  // Fetch a pool of candidates with their metadata signals.
  const poolSize = Math.max(limit * 5, 200);

  const candidates = await db.file.findMany({
    where,
    include: {
      tags: { include: { tag: true } },
      previews: { where: { size: 'THUMBNAIL' } },
      faces: { select: { id: true, personId: true, person: { select: { isConfirmed: true } } } },
      _count: { select: { metadataEdits: true } },
    },
    orderBy: [{ updatedAt: 'asc' }],
    take: poolSize,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const filtered = await applyIgnoreFilter(candidates);
  const now = Date.now();

  type Scored = {
    file: (typeof candidates)[number];
    score: number;
    reasons: string[];
  };

  const scored: Scored[] = [];

  for (const file of filtered) {
    let score = 0;
    const reasons: string[] = [];

    const hasTitle = !!file.title;
    const hasDescription = !!file.description;
    const manualTags = file.tags.filter((t) => t.source === 'manual');
    const hasManualTags = manualTags.length > 0;
    const meta = file.meta as { fields?: Record<string, unknown>; system?: Record<string, unknown> } | null;
    const aiTags = Array.isArray(meta?.fields?.aiTags) ? meta!.fields!.aiTags : [];
    const people = meta?.fields?.people;
    const hasPeople = Array.isArray(people) && people.length > 0;
    const unconfirmedFaces = file.faces.filter(
      (f) => f.personId && f.person && !f.person.isConfirmed,
    );
    const hasUnconfirmedFaces = unconfirmedFaces.length > 0;
    const hasBeenEdited = file._count.metadataEdits > 0;

    // Check if this item was already reviewed (via meta.system.reviewedAt)
    const reviewedAt = meta?.system?.reviewedAt as string | undefined;

    // Apply content-based filters
    if (requireMissingTitle && hasTitle) continue;
    if (requireMissingTags && hasManualTags) continue;
    if (requireMissingPeople && hasPeople) continue;
    if (requireUnconfirmedFaces && !hasUnconfirmedFaces) continue;

    // Scoring
    if (!hasTitle) {
      score += 25;
      reasons.push('Missing title');
    }
    if (!hasDescription) {
      score += 15;
      reasons.push('Missing description');
    }
    if (!hasManualTags) {
      score += 15;
      reasons.push('No tags');
    }
    if (!hasPeople) {
      score += 10;
      reasons.push('No people tagged');
    }
    if (aiTags.length > 0 && !hasManualTags) {
      score += 10;
      reasons.push('AI tags need review');
    }
    if (hasUnconfirmedFaces) {
      score += 20;
      reasons.push(`${unconfirmedFaces.length} unconfirmed face${unconfirmedFaces.length > 1 ? 's' : ''}`);
    }
    if (!hasBeenEdited) {
      score += 20;
      reasons.push('Never edited');
    }

    // Staleness: days since last update (capped at 30)
    const lastUpdate = reviewedAt ? new Date(reviewedAt) : file.updatedAt;
    const daysSince = Math.min(30, Math.floor((now - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)));
    score += daysSince;

    // Items already reviewed get a large penalty so they sort to the bottom
    if (reviewedAt) {
      score -= 50;
    }

    scored.push({ file, score, reasons });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const page = scored.slice(0, limit);

  // Total count
  const totalCount = await db.file.count({ where });

  // Count reviewed items via scoring (no extra query needed since we already
  // loaded the pool). For a rough count, just count items in the pool that
  // have been reviewed — the total is approximate anyway.
  const reviewedInPool = filtered.filter((f) => {
    const m = f.meta as { system?: Record<string, unknown> } | null;
    return !!m?.system?.reviewedAt;
  }).length;
  const reviewedCount = reviewedInPool;

  return NextResponse.json({
    items: page.map((s) => ({
      file: serializeFile(s.file),
      score: Number(s.score.toFixed(1)),
      reasons: s.reasons.slice(0, 4),
    })),
    totalCount,
    reviewedCount,
    needsReviewCount: totalCount - reviewedCount,
    nextCursor: page.length === limit ? page[page.length - 1]!.file.id : null,
  });
  } catch (error) {
    console.error('[Review API] Error:', error);
    return NextResponse.json({
      items: [],
      totalCount: 0,
      reviewedCount: 0,
      needsReviewCount: 0,
      nextCursor: null,
    });
  }
}

/**
 * POST /api/review
 *
 * Mark a file as reviewed. Stores reviewedAt in meta.system.
 * Body: { fileId: string }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'review', 'access');
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const fileId = body.fileId;

  if (!fileId || typeof fileId !== 'string') {
    return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Read current meta, merge in reviewedAt under system key
  const file = await db.file.findUnique({
    where: { id: fileId },
    select: { meta: true },
  });

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const meta = (file.meta ?? {}) as Record<string, unknown>;
  const system = (meta.system ?? {}) as Record<string, unknown>;

  await db.file.update({
    where: { id: fileId },
    data: {
      meta: {
        ...meta,
        system: { ...system, reviewedAt: now },
      },
    },
  });

  return NextResponse.json({ ok: true, reviewedAt: now });
}

// ─── Helpers ──────────────────────────────────────────────────

/** Build a Prisma filter for files within a folder and all its subfolders. */
async function buildFolderFilter(folderId: string): Promise<Prisma.FileWhereInput> {
  const folder = await db.folder.findUnique({
    where: { id: folderId },
    select: { path: true },
  });
  if (!folder) return { folderId };

  // Match files in this folder or any subfolder by path prefix
  return { path: { startsWith: folder.path + '/' } };
}
