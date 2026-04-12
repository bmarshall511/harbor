import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/person-relationships/:id — Update a relationship (admin only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const relationship = await db.personRelationship.update({
    where: { id },
    data: {
      ...(body.relationType !== undefined ? { relationType: body.relationType } : {}),
      ...(body.label !== undefined ? { label: body.label || null } : {}),
      ...(body.isBidirectional !== undefined ? { isBidirectional: body.isBidirectional } : {}),
    },
  });

  return NextResponse.json(relationship);
}

/** DELETE /api/person-relationships/:id — Delete a relationship (admin only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  await db.personRelationship.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
