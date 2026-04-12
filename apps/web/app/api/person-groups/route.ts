import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** GET /api/person-groups — List all groups with members. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const groups = await db.personGroup.findMany({
      include: {
        members: {
          include: {
            person: { select: { id: true, name: true, avatarUrl: true, entityType: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(groups);
  } catch (err) {
    console.error('[PersonGroups] GET failed:', err);
    return NextResponse.json([]);
  }
}

/** POST /api/person-groups — Create a group (admin only). */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  try {
    const { name, color } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ message: 'Name is required' }, { status: 400 });
    }

    const group = await db.personGroup.create({
      data: { name: name.trim(), color: color || null },
      include: { members: true },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    console.error('[PersonGroups] POST failed:', err);
    return NextResponse.json({ message: 'Failed to create group' }, { status: 500 });
  }
}
