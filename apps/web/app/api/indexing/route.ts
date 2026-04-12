import { NextResponse } from 'next/server';
import { IndexingJob } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { ArchiveRootRepository, db } from '@harbor/database';
import { isCloudMode } from '@/lib/deployment';

export const maxDuration = 120;

/** Max execution time per chunk. 80s leaves 40s buffer for Vercel's 120s limit
 * (need time for post-interrupt cleanup, DB writes, and response). */
const CHUNK_TIMEOUT_MS = isCloudMode ? 80_000 : 0; // 0 = no timeout for local

const rootRepo = new ArchiveRootRepository();

/**
 * POST /api/indexing
 *
 * For local mode: runs indexing to completion (no timeout).
 * For cloud mode (Vercel): runs for up to 95 seconds per request.
 * The UI auto-retries via the `continue` field in the response,
 * enabling indexing of archives that take hours or days.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.archive_roots', 'access');
  if (denied) return denied;

  try {
    const { archiveRootId, continueJobId } = await request.json();
    if (!archiveRootId) {
      return NextResponse.json({ message: 'archiveRootId is required' }, { status: 400 });
    }

    const root = await rootRepo.findById(archiveRootId);
    if (!root) {
      return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });
    }

    let dropboxCredentials: { appKey: string; appSecret: string } | undefined;
    if (root.providerType === 'DROPBOX') {
      const appKey = await getSecret('dropbox.appKey');
      const appSecret = await getSecret('dropbox.appSecret');
      if (!appKey || !appSecret) {
        return NextResponse.json({ message: 'Dropbox credentials not configured. Add them in Settings.' }, { status: 400 });
      }
      dropboxCredentials = { appKey, appSecret };
    }

    // Check if there's already a RUNNING index job for this archive.
    // Prevents duplicate jobs from concurrent server+client continuations.
    const existingRunning = await db.backgroundJob.findFirst({
      where: {
        type: 'index',
        status: 'RUNNING',
        metadata: { path: ['archiveRootId'], equals: archiveRootId },
      },
    });
    if (existingRunning && continueJobId) {
      // Another chunk is already running — skip this duplicate
      return NextResponse.json({ message: 'Already running', status: 'running' });
    }

    // Only cancel existing jobs when starting fresh (not continuing)
    if (!continueJobId) {
      await db.backgroundJob.updateMany({
        where: {
          type: 'index',
          status: { in: ['RUNNING', 'QUEUED'] },
          metadata: { path: ['archiveRootId'], equals: archiveRootId },
        },
        data: { status: 'FAILED', error: 'Cancelled — re-index requested', completedAt: new Date() },
      });
    }

    const indexingJob = new IndexingJob();

    // Set a deadline for cloud mode so we don't exceed Vercel's timeout
    if (CHUNK_TIMEOUT_MS > 0) {
      indexingJob.setDeadline(Date.now() + CHUNK_TIMEOUT_MS);
    }

    // On continuation, read the resume position from the previous job
    if (continueJobId) {
      const prevJob = await db.backgroundJob.findUnique({ where: { id: continueJobId } });
      const resumeAt = (prevJob?.metadata as any)?.resumeAt;
      if (typeof resumeAt === 'number' && resumeAt > 0) {
        indexingJob.setSkipCount(resumeAt);
      }
    }

    await indexingJob.indexArchiveRoot(archiveRootId, auth.userId, dropboxCredentials);

    // Check if the job hit the deadline and needs to continue
    if (indexingJob.wasInterrupted()) {
      const stats = indexingJob.getStats();

      // SERVER-DRIVEN continuation: fire the next chunk from the server
      // so it doesn't depend on the browser tab being active.
      // Use the origin from the request to build the URL.
      const origin = request.headers.get('origin')
        ?? request.headers.get('x-forwarded-host')
        ?? new URL(request.url).origin;
      const continueUrl = `${origin.startsWith('http') ? origin : `https://${origin}`}/api/indexing`;

      // Extract session cookie to authenticate the continuation request
      const cookie = request.headers.get('cookie') ?? '';

      // Fire-and-forget — don't await, this runs after we return
      globalThis.fetch(continueUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie,
        },
        body: JSON.stringify({
          archiveRootId,
          continueJobId: stats.jobId,
        }),
      }).catch((err) => {
        console.error('[Indexing] Server-side continuation failed:', err);
      });

      return NextResponse.json({
        message: 'Indexing in progress — next chunk will start automatically',
        archiveRootId,
        status: 'in_progress',
        continue: true,
        jobId: stats.jobId,
        filesProcessed: stats.filesProcessed,
        foldersProcessed: stats.foldersProcessed,
      });
    }

    return NextResponse.json({
      message: 'Indexing complete',
      archiveRootId,
      status: 'complete',
      continue: false,
    });
  } catch (error: unknown) {
    console.error('[Indexing] Failed:', error);
    const message = error instanceof Error ? error.message : 'Indexing failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
