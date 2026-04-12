import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/person-relationships/:id — Update a relationship (admin only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  try {
    const relationship = await db.personRelationship.update({
      where: { id },
      data: {
        ...(body.relationType !== undefined ? { relationType: body.relationType } : {}),
        ...(body.label !== undefined ? { label: body.label || null } : {}),
        ...(body.isBidirectional !== undefined ? { isBidirectional: body.isBidirectional } : {}),
      },
    });

    return NextResponse.json(relationship);
  } catch (err) {
    console.error('[PersonRelationships] PATCH failed:', err);
    return NextResponse.json({ message: 'Failed to update' }, { status: 500 });
  }
}

/**
 * DELETE /api/person-relationships/:id
 *
 * Deletes a relationship AND its auto-created reciprocal.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;

  try {
    // Delete any reciprocals that point back to this relationship
    await db.personRelationship.deleteMany({
      where: { reciprocalId: id },
    });

    // Delete the primary relationship itself
    await db.personRelationship.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[PersonRelationships] DELETE failed:', err);
    return NextResponse.json({ message: 'Failed to delete' }, { status: 500 });
  }
}
