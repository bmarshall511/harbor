import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { permissionService } from '@/lib/auth';

/** GET /api/collections — List collections visible to the current user. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const isAdmin = permissionService.isAdmin(auth);

  // Users see their own collections + public collections from others
  const collections = await db.collection.findMany({
    where: isAdmin
      ? {} // Admins see everything
      : { OR: [{ userId: auth.userId }, { isPrivate: false }] },
    include: { _count: { select: { items: true } }, user: { select: { displayName: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(collections.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    color: c.color,
    isPrivate: c.isPrivate,
    isOwn: c.userId === auth.userId,
    ownerName: c.user.displayName,
    itemCount: c._count.items,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  })));
}

/** POST /api/collections — Create a new collection. */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { name, description, color, isPrivate } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ message: 'Name is required' }, { status: 400 });
  }

  const collection = await db.collection.create({
    data: {
      userId: auth.userId,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || null,
      isPrivate: isPrivate !== false, // Default to private
    },
  });

  return NextResponse.json(collection, { status: 201 });
}
