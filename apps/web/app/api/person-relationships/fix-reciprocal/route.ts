import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const SYMMETRIC = new Set(['spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague']);

/**
 * POST /api/person-relationships/fix-reciprocal
 *
 * Creates ONLY the missing inverse record for an existing relationship.
 * Unlike the main POST endpoint (which creates both directions), this
 * creates a single record — the reciprocal that should have existed.
 *
 * Body: {
 *   sourcePersonId: string,   // The person who should be the source of the NEW record
 *   targetPersonId: string,   // The person who should be the target of the NEW record
 *   relationType: string,     // The relationship type for the NEW record
 * }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const { sourcePersonId, targetPersonId, relationType } = body;

  if (!sourcePersonId || !targetPersonId || !relationType) {
    return NextResponse.json({ error: 'sourcePersonId, targetPersonId, relationType required' }, { status: 400 });
  }

  // Check if this exact record already exists
  const existing = await db.personRelationship.findFirst({
    where: { sourcePersonId, targetPersonId, relationType },
  });

  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, message: 'Already exists' });
  }

  // Find the original record this is the reciprocal of
  const INVERSE_MAP: Record<string, string> = {
    child: 'parent', parent: 'child',
    grandchild: 'grandparent', grandparent: 'grandchild',
    'niece/nephew': 'aunt/uncle', 'aunt/uncle': 'niece/nephew',
    report: 'manager', manager: 'report',
    pet_of: 'owner', owner: 'pet_of',
  };
  const inverseType = SYMMETRIC.has(relationType) ? relationType : (INVERSE_MAP[relationType] ?? relationType);

  const original = await db.personRelationship.findFirst({
    where: { sourcePersonId: targetPersonId, targetPersonId: sourcePersonId, relationType: inverseType },
  });

  // Create the reciprocal record
  await db.personRelationship.create({
    data: {
      sourcePersonId,
      targetPersonId,
      relationType,
      isBidirectional: SYMMETRIC.has(relationType),
      reciprocalId: original?.id ?? null,
    },
  });

  return NextResponse.json({ ok: true, created: true });
}
