import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { IndexingJob } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { ArchiveRootRepository } from '@harbor/database';

export const maxDuration = 120;

const rootRepo = new ArchiveRootRepository();

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  try {
    const { archiveRootId } = await request.json();
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

    // Use next/server `after()` to run indexing AFTER the response is
    // sent but BEFORE the function is killed. On Vercel, this keeps
    // the serverless function alive until the promise resolves (up to
    // maxDuration seconds). Without this, Vercel kills the process
    // as soon as the response is sent and indexing never completes.
    const indexingJob = new IndexingJob();
    after(async () => {
      try {
        await indexingJob.indexArchiveRoot(archiveRootId, auth.userId, dropboxCredentials);
      } catch (err) {
        console.error(`[Indexing] Failed for ${archiveRootId}:`, err);
      }
    });

    return NextResponse.json({ message: 'Indexing started', archiveRootId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
