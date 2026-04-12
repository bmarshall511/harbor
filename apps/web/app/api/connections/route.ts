import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/connections — Graph data for the Connections page.
 *
 * Returns all named persons as nodes, all primary relationships as
 * edges (reciprocals are filtered out — only one direction per pair),
 * and all groups for visual clustering.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const [persons, relationships, groups] = await Promise.all([
      db.person.findMany({
        where: { name: { not: null } },
        include: {
          _count: { select: { faces: true, relationshipsAsSource: true, relationshipsAsTarget: true } },
          linkedUser: { select: { avatarUrl: true } },
          groupMemberships: { select: { groupId: true, role: true } },
        },
      }),
      // Only fetch primary relationships (reciprocals have reciprocalId set)
      db.personRelationship.findMany({
        where: { reciprocalId: null },
      }),
      db.personGroup.findMany({
        include: {
          members: { select: { personId: true, role: true } },
        },
      }),
    ]);

    const nodes = persons.map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarFileId
        ? `/api/files/${p.avatarFileId}/preview?size=THUMBNAIL`
        : (p.avatarUrl ?? p.linkedUser?.avatarUrl ?? null),
      entityType: p.entityType ?? 'PERSON',
      gender: p.gender ?? null,
      faceCount: p._count.faces,
      relationshipCount: p._count.relationshipsAsSource + p._count.relationshipsAsTarget,
      groups: p.groupMemberships.map((m) => ({ groupId: m.groupId, role: m.role })),
    }));

    const edges = relationships.map((r) => ({
      id: r.id,
      source: r.sourcePersonId,
      target: r.targetPersonId,
      relationType: r.relationType,
      label: r.label,
      isBidirectional: r.isBidirectional,
    }));

    const groupsData = groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      memberIds: g.members.map((m) => m.personId),
    }));

    return NextResponse.json({ nodes, edges, groups: groupsData });
  } catch (err) {
    console.error('[Connections] GET failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to load connections';
    return NextResponse.json({ message }, { status: 500 });
  }
}
