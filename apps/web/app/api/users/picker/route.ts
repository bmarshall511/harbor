import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/users/picker — Lightweight user list for picker UIs
 * (e.g. the People metadata field). Available to any authenticated
 * user; returns only id + display name + username so that nothing
 * sensitive (email, role, status) leaks to non-admins.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
    orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName ?? u.username,
    })),
  );
}
