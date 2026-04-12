import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/admin/delete-queue
 *
 * Returns:
 *   • `pending`            — list of DeleteRequest rows currently
 *                            awaiting admin action, newest first
 *   • `pendingCount`       — number of pending requests
 *   • `pendingBytes`       — total bytes the queue is sitting on
 *                            (sum of `file_size` over pending rows)
 *   • `reclaimedBytes`     — cumulative bytes freed by APPROVED
 *                            deletes, all-time
 *   • `reclaimedCount`     — cumulative number of files removed
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.delete_queue', 'access');
  if (denied) return denied;

  const [pending, stats, approvedStats] = await Promise.all([
    db.deleteRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
      include: {
        archiveRoot: { select: { id: true, name: true, providerType: true } },
        requestedBy: { select: { id: true, username: true, displayName: true } },
      },
    }),
    db.deleteRequest.aggregate({
      where: { status: 'PENDING' },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
    db.deleteRequest.aggregate({
      where: { status: 'APPROVED' },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
  ]);

  return NextResponse.json({
    pending: pending.map((p) => ({
      id: p.id,
      fileId: p.fileId,
      archiveRootId: p.archiveRootId,
      archiveRootName: p.archiveRoot.name,
      providerType: p.archiveRoot.providerType,
      fileName: p.fileName,
      filePath: p.filePath,
      fileSize: Number(p.fileSize),
      fileMimeType: p.fileMimeType,
      reason: p.reason,
      requestedAt: p.requestedAt.toISOString(),
      requestedBy: {
        id: p.requestedBy.id,
        username: p.requestedBy.username,
        displayName: p.requestedBy.displayName,
      },
    })),
    pendingCount: stats._count._all,
    pendingBytes: Number(stats._sum.fileSize ?? 0),
    reclaimedCount: approvedStats._count._all,
    reclaimedBytes: Number(approvedStats._sum.fileSize ?? 0),
  });
}
