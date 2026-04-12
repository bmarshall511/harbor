import { NextResponse } from 'next/server';
import { JobManager } from '@harbor/jobs';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const jobManager = new JobManager();

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Auto-expire RUNNING jobs older than 10 minutes. On Vercel, functions
  // time out at 120s but the DB record stays RUNNING forever, creating
  // phantom "stuck" jobs in the UI.
  await db.backgroundJob.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
    },
    data: { status: 'FAILED', error: 'Timed out', completedAt: new Date() },
  }).catch(() => {});

  const jobs = await jobManager.findRecent();
  return NextResponse.json(
    jobs.map((j) => ({
      id: j.id,
      type: j.type,
      entityType: j.entityType,
      entityId: j.entityId,
      status: j.status,
      progress: j.progress,
      error: j.error,
      metadata: j.metadata,
      createdAt: j.createdAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
    })),
  );
}
