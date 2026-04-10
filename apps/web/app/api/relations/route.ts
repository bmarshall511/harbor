import { NextResponse } from 'next/server';
import { RelationRepository } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const repo = new RelationRepository();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get('entityType') as 'FILE' | 'FOLDER';
  const entityId = searchParams.get('entityId');

  if (!entityType || !entityId) {
    return NextResponse.json({ message: 'entityType and entityId are required' }, { status: 400 });
  }

  const relations = await repo.findByEntity(entityType, entityId);
  return NextResponse.json(relations);
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'relations', 'write');
  if (denied) return denied;

  try {
    const body = await request.json();
    const relation = await repo.create({
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      targetType: body.targetType,
      targetId: body.targetId,
      relationType: body.relationType,
      isBidirectional: body.isBidirectional,
      notes: body.notes,
    });

    await audit(auth, 'link', body.sourceType, body.sourceId, undefined, { relationId: relation.id, targetType: body.targetType, targetId: body.targetId, relationType: body.relationType });
    emit('relation.created', { relationId: relation.id, sourceType: body.sourceType, sourceId: body.sourceId, targetType: body.targetType, targetId: body.targetId }, { userId: auth.userId });

    return NextResponse.json(relation, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
