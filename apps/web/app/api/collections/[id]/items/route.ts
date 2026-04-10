import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** POST /api/collections/:id/items — Add item to collection. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const collection = await db.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const { entityType, entityId } = await request.json();
  if (!entityType || !entityId) {
    return NextResponse.json({ message: 'entityType and entityId required' }, { status: 400 });
  }

  const item = await db.collectionItem.upsert({
    where: { collectionId_entityType_entityId: { collectionId: id, entityType, entityId } },
    create: { collectionId: id, entityType, entityId },
    update: {},
  });

  return NextResponse.json(item, { status: 201 });
}

/** DELETE /api/collections/:id/items — Remove item from collection. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { entityType, entityId } = await request.json();

  await db.collectionItem.deleteMany({
    where: { collectionId: id, entityType, entityId },
  });

  return NextResponse.json({ ok: true });
}
