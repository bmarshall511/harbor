import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** GET /api/favorites — List all favorites for the current user. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const favorites = await db.favorite.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(favorites);
}

/** POST /api/favorites — Toggle a favorite. */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { entityType, entityId } = await request.json();
  if (!entityType || !entityId) {
    return NextResponse.json({ message: 'entityType and entityId required' }, { status: 400 });
  }

  // Check if already favorited
  const existing = await db.favorite.findUnique({
    where: { userId_entityType_entityId: { userId: auth.userId, entityType, entityId } },
  });

  if (existing) {
    // Unfavorite
    await db.favorite.delete({ where: { id: existing.id } });
    return NextResponse.json({ favorited: false });
  }

  // Favorite
  const fav = await db.favorite.create({
    data: { userId: auth.userId, entityType, entityId },
  });

  return NextResponse.json({ favorited: true, id: fav.id });
}
