import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** GET /api/roles — List all available roles. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const roles = await db.role.findMany({
    orderBy: { createdAt: 'asc' },
    include: { permissions: { select: { resource: true, action: true } } },
  });

  return NextResponse.json(roles.map((r) => ({
    id: r.id,
    name: r.name,
    systemRole: r.systemRole,
    description: r.description,
    permissions: r.permissions.map((p) => ({ resource: p.resource, action: p.action })),
  })));
}
