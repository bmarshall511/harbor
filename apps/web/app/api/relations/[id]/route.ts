import { NextResponse } from 'next/server';
import { RelationRepository } from '@harbor/database';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const repo = new RelationRepository();

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'relations', 'delete');
  if (denied) return denied;

  const { id } = await params;

  // Look up the relation before deleting
  const relation = await db.entityRelation.findUnique({ where: { id } });
  if (!relation) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  await repo.delete(id);

  await audit(auth, 'unlink', relation.sourceType, relation.sourceId, { relationId: id, targetType: relation.targetType, targetId: relation.targetId, relationType: relation.relationType });
  emit('relation.deleted', { relationId: id, sourceType: relation.sourceType, sourceId: relation.sourceId }, { userId: auth.userId });

  return new NextResponse(null, { status: 204 });
}
