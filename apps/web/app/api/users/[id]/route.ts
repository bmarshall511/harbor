import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/users/:id — Update user (role, active status). Admin only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // Update active status
  if (body.isActive !== undefined) {
    await db.user.update({ where: { id }, data: { isActive: body.isActive } });
  }

  // Update role assignment
  if (body.roleId) {
    // Remove old role assignments and set new one
    await db.userRoleAssignment.deleteMany({ where: { userId: id } });
    await db.userRoleAssignment.create({
      data: { userId: id, roleId: body.roleId },
    });
  }

  return NextResponse.json({ ok: true });
}
