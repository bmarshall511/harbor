import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** GET /api/search/saved — List saved searches for the current user. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const saved = await db.savedSearch.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(
    saved.map((s) => ({
      id: s.id,
      name: s.name,
      query: s.query,
      filters: s.filters,
      createdAt: s.createdAt.toISOString(),
    })),
  );
}

/** POST /api/search/saved — Create a saved search. */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { name, query, filters } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ message: 'Name is required' }, { status: 400 });
  }

  const saved = await db.savedSearch.create({
    data: {
      userId: auth.userId,
      name: name.trim(),
      query: query ?? '',
      filters: filters ?? {},
    },
  });

  return NextResponse.json({
    id: saved.id,
    name: saved.name,
    query: saved.query,
    filters: saved.filters,
    createdAt: saved.createdAt.toISOString(),
  }, { status: 201 });
}
