import { NextResponse } from 'next/server';
import { db, Prisma } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/people-suggestions?fieldKey=people
 *
 * Returns the list of distinct free-text person names that have ever
 * been entered into the given People metadata field across all files.
 * Used by the People picker to remember previously-typed names like
 * "Aunt Linda" so the user only has to type them once.
 *
 * Reads from the `meta` JSON column on `files` (the canonical mirror
 * of the on-disk JSON). The query uses Postgres jsonb path filtering
 * so we only scan rows that actually have the requested field set.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const fieldKey = url.searchParams.get('fieldKey');
  if (!fieldKey) {
    return NextResponse.json({ message: 'fieldKey required' }, { status: 400 });
  }

  // Pull every file whose `meta.fields.{fieldKey}` is set. We rely on
  // the GIN index on `meta` for this lookup, then walk the rows in JS
  // to extract the unique free-text person names.
  const rows = await db.file.findMany({
    where: {
      meta: {
        path: ['fields', fieldKey],
        not: Prisma.JsonNull,
      },
    },
    select: { meta: true },
    take: 5000,
  });

  const names = new Set<string>();
  for (const row of rows) {
    const meta = row.meta as { fields?: Record<string, unknown> } | null;
    const value = meta?.fields?.[fieldKey];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object' && (item as Record<string, unknown>).kind === 'free') {
        const name = (item as Record<string, unknown>).name;
        if (typeof name === 'string' && name.trim()) names.add(name.trim());
      }
    }
  }

  return NextResponse.json([...names].sort((a, b) => a.localeCompare(b)));
}
