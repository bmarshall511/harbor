import { NextResponse } from 'next/server';
import { FileRepository, db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const fileRepo = new FileRepository();

/**
 * POST /api/files/:id/delete-request
 *
 * "Mark for delete." Any user with `files:delete` permission can
 * call this. The file is moved to `PENDING_DELETE` status (so it
 * disappears from listings everywhere) and a `DeleteRequest` row
 * is created. The bytes stay on disk and the file row stays in
 * the DB until an admin approves the request from the admin
 * "Delete Queue" page.
 *
 * Body: `{ reason?: string }`
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Same permission as a hard delete used to need — anyone who
  // could delete before can mark for delete now.
  const denied = requirePermission(auth, 'files', 'delete');
  if (denied) return denied;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  if (file.status === 'PENDING_DELETE' || file.status === 'DELETED') {
    return NextResponse.json({ message: 'File is already marked for delete' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  // Snapshot identifying info so the queue can show meaningful stats
  // even after the file row is hard-deleted by an admin.
  const deleteRequest = await db.deleteRequest.create({
    data: {
      fileId: file.id,
      archiveRootId: file.archiveRootId,
      fileName: file.name,
      filePath: file.path,
      fileSize: file.size,
      fileMimeType: file.mimeType,
      reason: reason || null,
      requestedByUserId: auth.userId,
    },
  });

  // Move the file out of user-visible state.
  await fileRepo.markForDelete(file.id);

  await audit(auth, 'mark-for-delete', 'FILE', file.id, { name: file.name, path: file.path }, { reason });
  emit(
    'file.updated',
    { fileId: file.id, path: file.path, archiveRootId: file.archiveRootId },
    { archiveRootId: file.archiveRootId, userId: auth.userId },
  );

  return NextResponse.json({ ok: true, deleteRequestId: deleteRequest.id });
}
