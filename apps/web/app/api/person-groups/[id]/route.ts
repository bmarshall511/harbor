import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/person-groups/:id — Update a group (admin only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;
  try {
    const body = await request.json();
    const group = await db.personGroup.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color || null } : {}),
      },
    });
    return NextResponse.json(group);
  } catch (err) {
    console.error('[PersonGroups] PATCH failed:', err);
    return NextResponse.json({ message: 'Failed to update group' }, { status: 500 });
  }
}

/** DELETE /api/person-groups/:id — Delete a group (admin only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;
  try {
    await db.personGroup.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ message: 'Group not found' }, { status: 404 });
  }
}
