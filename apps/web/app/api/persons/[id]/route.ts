import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/persons/:id — Update a person (admin only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const person = await db.person.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      ...(body.linkedUserId !== undefined ? { linkedUserId: body.linkedUserId || null } : {}),
      ...(body.isConfirmed !== undefined ? { isConfirmed: body.isConfirmed } : {}),
    },
  });

  return NextResponse.json(person);
}

/** DELETE /api/persons/:id — Delete a person (admin only). Faces are unlinked, not deleted. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  await db.person.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
