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

  try {
    const body = await request.json();

    const person = await db.person.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.avatarFileId !== undefined ? {
          avatarFileId: body.avatarFileId || null,
          // Compute the URL from the file ID
          avatarUrl: body.avatarFileId ? `/api/files/${body.avatarFileId}/preview?size=THUMBNAIL` : null,
        } : {}),
        ...(body.linkedUserId !== undefined ? { linkedUserId: body.linkedUserId || null } : {}),
        ...(body.isConfirmed !== undefined ? { isConfirmed: body.isConfirmed } : {}),
        ...(body.entityType !== undefined ? { entityType: body.entityType } : {}),
        ...(body.gender !== undefined ? { gender: ['MALE', 'FEMALE', 'OTHER'].includes(body.gender) ? body.gender : null } : {}),
      },
    });

    return NextResponse.json(person);
  } catch (err) {
    console.error('[Persons] PATCH failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to update person';
    return NextResponse.json({ message }, { status: 500 });
  }
}

/** DELETE /api/persons/:id — Delete a person (admin only). Faces are unlinked, not deleted. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;

  try {
    await db.person.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[Persons] DELETE failed:', err);
    return NextResponse.json({ message: 'Person not found' }, { status: 404 });
  }
}
