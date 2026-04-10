import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** GET /api/collections/:id — Get collection with items. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const collection = await db.collection.findUnique({
    where: { id },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });

  if (!collection || collection.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(collection);
}

/** PATCH /api/collections/:id — Update collection. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const collection = await db.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const { name, description, color } = await request.json();
  const updated = await db.collection.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(color !== undefined ? { color: color || null } : {}),
    },
  });

  return NextResponse.json(updated);
}

/** DELETE /api/collections/:id — Delete collection (items cascade). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const collection = await db.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  await db.collection.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
