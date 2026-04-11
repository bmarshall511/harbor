import { NextResponse } from 'next/server';
import { ArchiveRootRepository } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const repo = new ArchiveRootRepository();

/**
 * GET /api/archive-roots/:id/access — Get current user access list.
 * PUT /api/archive-roots/:id/access — Set user access list.
 *   Body: { userIds: string[] }
 *   Empty array = everyone (isPrivate = false).
 *   Non-empty array = only those users (isPrivate = true).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const root = await repo.findById(id);
  if (!root) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  return NextResponse.json({
    isPrivate: root.isPrivate,
    userIds: root.userAccesses?.map((a) => a.userId) ?? [],
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const { userIds } = await request.json() as { userIds: string[] };

  const root = await repo.findById(id);
  if (!root) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // Empty userIds = everyone has access (not private)
  // Non-empty userIds = only those users (private)
  const isPrivate = Array.isArray(userIds) && userIds.length > 0;

  await repo.update(id, { isPrivate });
  await repo.setUserAccess(id, isPrivate ? userIds : []);

  return NextResponse.json({ ok: true, isPrivate, userIds: isPrivate ? userIds : [] });
}
