import { NextResponse } from 'next/server';
import { JobManager } from '@harbor/jobs';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { isCloudMode } from '@/lib/deployment';

const jobManager = new JobManager();

// On Vercel (cloud), functions time out at 120s — any job RUNNING
// longer than 3 minutes is a zombie from a killed function.
// Locally, indexing can legitimately run for hours, so use 24h.
const STALE_THRESHOLD_MS = isCloudMode
  ? 3 * 60 * 1000    // 3 minutes for cloud
  : 24 * 60 * 60 * 1000; // 24 hours for local

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Auto-expire truly stuck jobs — cloud: 3min, local: 24h
  await db.backgroundJob.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
    },
    data: { status: 'FAILED', error: 'Timed out — no progress', completedAt: new Date() },
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
