import { NextResponse } from 'next/server';
import { JobManager } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';

const jobManager = new JobManager();

/** DELETE /api/jobs/:id — Cancel a running or queued job. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;

  try {
    await jobManager.cancel(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: 'Job not found' }, { status: 404 });
  }
}
