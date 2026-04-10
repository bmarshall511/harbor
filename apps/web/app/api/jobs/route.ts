import { NextResponse } from 'next/server';
import { JobManager } from '@harbor/jobs';
import { requireAuth } from '@/lib/auth';

const jobManager = new JobManager();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

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
