import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** GET /api/roles/:id/permissions — Get all permissions for a role. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.users', 'access');
  if (denied) return denied;

  const { id } = await params;
  const role = await db.role.findUnique({
    where: { id },
    include: { permissions: true },
  });
  if (!role) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  return NextResponse.json({
    roleId: role.id,
    roleName: role.name,
    systemRole: role.systemRole,
    permissions: role.permissions.map((p) => ({
      resource: p.resource,
      action: p.action,
    })),
  });
}

/**
 * PUT /api/roles/:id/permissions — Replace all permissions for a role.
 * Body: { permissions: Array<{ resource: string; action: string }> }
 *
 * Owner role cannot be modified.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.users', 'access');
  if (denied) return denied;

  const { id } = await params;
  const role = await db.role.findUnique({ where: { id } });
  if (!role) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // Owner role is immutable
  if (role.systemRole === 'OWNER') {
    return NextResponse.json({ message: 'Owner role permissions cannot be modified' }, { status: 403 });
  }

  const { permissions } = await request.json() as {
    permissions: Array<{ resource: string; action: string }>;
  };

  if (!Array.isArray(permissions)) {
    return NextResponse.json({ message: 'permissions array required' }, { status: 400 });
  }

  // Replace all permissions in a transaction
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: id } }),
    db.rolePermission.createMany({
      data: permissions.map((p) => ({
        roleId: id,
        resource: p.resource,
        action: p.action,
      })),
      skipDuplicates: true,
    }),
  ]);

  return NextResponse.json({ ok: true, count: permissions.length });
}
