import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const INVERSE_MAP: Record<string, string> = {
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  'aunt/uncle': 'niece/nephew',
  'niece/nephew': 'aunt/uncle',
  manager: 'report',
  report: 'manager',
  owner: 'pet_of',
  pet_of: 'owner',
};
const SYMMETRIC = new Set(['spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague']);

/**
 * POST /api/person-relationships/bulk
 *
 * Create multiple relationships at once, with automatic reciprocals.
 * Skips duplicates silently.
 *
 * Body: {
 *   relationships: Array<{ sourcePersonId, targetPersonId, relationType }>,
 *   groupMemberships?: Array<{ groupId, personId }>,
 * }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const { relationships, groupMemberships } = body as {
    relationships?: Array<{ sourcePersonId: string; targetPersonId: string; relationType: string }>;
    groupMemberships?: Array<{ groupId: string; personId: string }>;
  };

  if (!Array.isArray(relationships) || relationships.length === 0) {
    return NextResponse.json({ error: 'relationships[] is required' }, { status: 400 });
  }

  // Load existing relationships for duplicate detection
  const existing = await db.personRelationship.findMany({
    select: { sourcePersonId: true, targetPersonId: true, relationType: true },
  });
  const existingSet = new Set(
    existing.map((r) => `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`),
  );

  let created = 0;
  let skipped = 0;

  for (const rel of relationships) {
    const { sourcePersonId, targetPersonId, relationType } = rel;
    if (sourcePersonId === targetPersonId) { skipped++; continue; }

    // Check for existing (both directions for symmetric)
    const key = `${sourcePersonId}:${targetPersonId}:${relationType}`;
    const isSym = SYMMETRIC.has(relationType);
    const reverseKey = isSym
      ? `${targetPersonId}:${sourcePersonId}:${relationType}`
      : `${targetPersonId}:${sourcePersonId}:${INVERSE_MAP[relationType] ?? relationType}`;

    if (existingSet.has(key) || existingSet.has(reverseKey)) {
      skipped++;
      continue;
    }

    // Create primary + reciprocal
    const inverseType = isSym ? relationType : (INVERSE_MAP[relationType] ?? relationType);

    const primary = await db.personRelationship.create({
      data: {
        sourcePersonId,
        targetPersonId,
        relationType,
        isBidirectional: isSym,
      },
    });

    await db.personRelationship.create({
      data: {
        sourcePersonId: targetPersonId,
        targetPersonId: sourcePersonId,
        relationType: inverseType,
        isBidirectional: isSym,
        reciprocalId: primary.id,
      },
    });

    // Track so we don't create duplicates within this batch
    existingSet.add(key);
    existingSet.add(reverseKey);
    created++;
  }

  // Group memberships
  let groupsAdded = 0;
  if (Array.isArray(groupMemberships)) {
    for (const { groupId, personId } of groupMemberships) {
      try {
        await db.personGroupMember.create({
          data: { groupId, personId },
        });
        groupsAdded++;
      } catch {
        // Unique constraint violation = already a member, skip
      }
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    skipped,
    groupsAdded,
  });
}
