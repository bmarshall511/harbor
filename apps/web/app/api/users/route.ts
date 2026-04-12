import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { hashPassword } from '@harbor/auth';
import { mergeFreeTextIntoUser } from '@/lib/people-merge';

/** GET /api/users — List all users with their roles. Admin only. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.users', 'access');
  if (denied) return denied;

  const users = await db.user.findMany({
    include: {
      roleAssignments: {
        include: { role: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    isActive: u.isActive,
    isLocalUser: u.isLocalUser,
    createdAt: u.createdAt.toISOString(),
    roles: u.roleAssignments.map((ra) => ({
      id: ra.role.id,
      name: ra.role.name,
      systemRole: ra.role.systemRole,
    })),
  })));
}

/** POST /api/users — Create a new user. Admin only. */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.users', 'access');
  if (denied) return denied;

  const { username, displayName, email, password, roleId } = await request.json();

  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ message: 'Username already exists' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: {
      username: username.trim(),
      displayName: (displayName || username).trim(),
      email: email?.trim() || null,
      passwordHash,
    },
  });

  // Assign role if provided
  if (roleId) {
    await db.userRoleAssignment.create({
      data: { userId: user.id, roleId },
    });
  }

  // Promote any matching free-text People entries on existing files
  // to point at this real user. e.g. if files were tagged with the
  // free-text "Aunt Linda" and Aunt Linda is now a registered user,
  // those tags become user references automatically.
  const merged = await mergeFreeTextIntoUser({
    id: user.id,
    displayName: user.displayName ?? user.username,
    username: user.username,
  });

  return NextResponse.json(
    { id: user.id, username: user.username, mergedFiles: merged },
    { status: 201 },
  );
}
