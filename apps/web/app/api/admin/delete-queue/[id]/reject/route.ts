import { NextResponse } from 'next/server';
import { db, FileRepository } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const fileRepo = new FileRepository();

/**
 * POST /api/admin/delete-queue/:id/reject
 *
 * Restore the file out of `PENDING_DELETE` back to `INDEXED` and
 * mark the request `REJECTED`. The file is fully visible again
 * in listings, viewers, and search.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.delete_queue', 'access');
  if (denied) return denied;

  const { id } = await params;
  const req = await db.deleteRequest.findUnique({ where: { id } });
  if (!req) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  if (req.status !== 'PENDING') {
    return NextResponse.json({ message: 'Request already resolved' }, { status: 409 });
  }

  if (req.fileId) {
    try { await fileRepo.unmarkForDelete(req.fileId); } catch { /* file may be gone */ }
  }
  await db.deleteRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      resolvedByUserId: auth.userId,
      resolvedAt: new Date(),
    },
  });

  await audit(auth, 'delete-rejected', 'FILE', req.fileId ?? req.id, { name: req.fileName, path: req.filePath });
  if (req.fileId) {
    emit(
      'file.updated',
      { fileId: req.fileId, path: req.filePath, archiveRootId: req.archiveRootId },
      { archiveRootId: req.archiveRootId, userId: auth.userId },
    );
  }

  return NextResponse.json({ ok: true });
}
