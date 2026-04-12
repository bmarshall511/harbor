import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/connections — Graph data for the Connections page.
 *
 * Returns all named persons as nodes and all relationships as edges,
 * pre-formatted for @xyflow/react consumption.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const [persons, relationships] = await Promise.all([
    db.person.findMany({
      where: { name: { not: null } },
      include: {
        _count: { select: { faces: true, relationshipsAsSource: true, relationshipsAsTarget: true } },
        linkedUser: { select: { avatarUrl: true } },
      },
    }),
    db.personRelationship.findMany(),
  ]);

  const nodes = persons.map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl ?? p.linkedUser?.avatarUrl ?? null,
    entityType: p.entityType ?? 'PERSON',
    faceCount: p._count.faces,
    relationshipCount: p._count.relationshipsAsSource + p._count.relationshipsAsTarget,
  }));

  const edges = relationships.map((r) => ({
    id: r.id,
    source: r.sourcePersonId,
    target: r.targetPersonId,
    relationType: r.relationType,
    label: r.label,
    isBidirectional: r.isBidirectional,
  }));

  return NextResponse.json({ nodes, edges });
}
