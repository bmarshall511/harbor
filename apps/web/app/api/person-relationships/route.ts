import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const PERSON_SELECT = { id: true, name: true, avatarUrl: true, entityType: true };

/**
 * Relationship type mapping for auto-reciprocals.
 *
 * Symmetric types (spouse, partner, sibling, friend, cousin, colleague)
 * create the same type in both directions.
 *
 * Directional types create the inverse in the other direction.
 */
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

const SYMMETRIC_TYPES = new Set([
  'spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague',
]);

function getInverse(relationType: string): string {
  if (SYMMETRIC_TYPES.has(relationType)) return relationType;
  return INVERSE_MAP[relationType] ?? relationType;
}

/**
 * GET /api/person-relationships
 *
 * Returns relationships de-duplicated: only the "primary" side is
 * returned (where reciprocalId is null or the row is the one with
 * the lower id). The admin UI shows each relationship as one row
 * with both people visible.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const all = await db.personRelationship.findMany({
      include: {
        sourcePerson: { select: PERSON_SELECT },
        targetPerson: { select: PERSON_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Only return primary relationships (not the auto-created reciprocals).
    // Primary = has no reciprocalId (it's the one the user created).
    const primary = all.filter((r) => !r.reciprocalId);

    return NextResponse.json(primary);
  } catch (err) {
    console.error('[PersonRelationships] GET failed:', err);
    return NextResponse.json([]);
  }
}

/**
 * POST /api/person-relationships
 *
 * Creates a relationship AND its automatic reciprocal.
 * "Mom is parent of Ben" creates:
 *   1. Mom → parent → Ben (primary)
 *   2. Ben → child → Mom (reciprocal, linked via reciprocalId)
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  try {
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

    const inverseType = getInverse(relationType);
    const isSymmetric = SYMMETRIC_TYPES.has(relationType);

    // Create the primary relationship
    const primary = await db.personRelationship.create({
      data: {
        sourcePersonId,
        targetPersonId,
        relationType,
        label: label || null,
        isBidirectional: isSymmetric || (isBidirectional ?? false),
      },
    });

    // Create the auto-reciprocal (inverse direction)
    await db.personRelationship.create({
      data: {
        sourcePersonId: targetPersonId,
        targetPersonId: sourcePersonId,
        relationType: inverseType,
        label: label || null,
        isBidirectional: isSymmetric || (isBidirectional ?? false),
        reciprocalId: primary.id, // Links back to the primary
      },
    });

    // Re-fetch with joined data for the response
    const result = await db.personRelationship.findUnique({
      where: { id: primary.id },
      include: {
        sourcePerson: { select: PERSON_SELECT },
        targetPerson: { select: PERSON_SELECT },
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[PersonRelationships] POST failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to create relationship';
    return NextResponse.json({ message }, { status: 500 });
  }
}
