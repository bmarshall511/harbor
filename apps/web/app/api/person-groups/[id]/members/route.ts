import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** POST /api/person-groups/:id/members — Add a member to a group. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;
  try {
    const { personId, role } = await request.json();
    if (!personId) return NextResponse.json({ message: 'personId is required' }, { status: 400 });

    const member = await db.personGroupMember.create({
      data: { groupId: id, personId, role: role || null },
      include: {
        person: { select: { id: true, name: true, avatarUrl: true, entityType: true } },
      },
    });

    return NextResponse.json(member, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add member';
    return NextResponse.json({ message }, { status: 500 });
  }
}

/** DELETE /api/person-groups/:id/members — Remove a member from a group. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { id } = await params;
  try {
    const { personId } = await request.json();
    if (!personId) return NextResponse.json({ message: 'personId is required' }, { status: 400 });

    await db.personGroupMember.deleteMany({
      where: { groupId: id, personId },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ message: 'Failed to remove member' }, { status: 500 });
  }
}
