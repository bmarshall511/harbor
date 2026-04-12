import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const PERSON_SELECT = { id: true, name: true, avatarUrl: true, entityType: true };

/** GET /api/person-relationships — List all person relationships with joined person data. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const relationships = await db.personRelationship.findMany({
    include: {
      sourcePerson: { select: PERSON_SELECT },
      targetPerson: { select: PERSON_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(relationships);
}

/** POST /api/person-relationships — Create a new relationship (admin only). */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { sourcePersonId, targetPersonId, relationType, label, isBidirectional } = await request.json();

  if (!sourcePersonId || !targetPersonId || !relationType) {
    return NextResponse.json(
      { message: 'sourcePersonId, targetPersonId, and relationType are required' },
      { status: 400 },
    );
  }

  if (sourcePersonId === targetPersonId) {
    return NextResponse.json({ message: 'Cannot create a relationship with the same person' }, { status: 400 });
  }

  const [source, target] = await Promise.all([
    db.person.findUnique({ where: { id: sourcePersonId } }),
    db.person.findUnique({ where: { id: targetPersonId } }),
  ]);

  if (!source || !target) {
    return NextResponse.json({ message: 'One or both persons not found' }, { status: 404 });
  }

  const relationship = await db.personRelationship.create({
    data: {
      sourcePersonId,
      targetPersonId,
      relationType,
      label: label || null,
      isBidirectional: isBidirectional ?? false,
    },
    include: {
      sourcePerson: { select: PERSON_SELECT },
      targetPerson: { select: PERSON_SELECT },
    },
  });

  return NextResponse.json(relationship, { status: 201 });
}
