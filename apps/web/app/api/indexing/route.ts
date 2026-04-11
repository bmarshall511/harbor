import { NextResponse } from 'next/server';
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

    // Run indexing synchronously — the response doesn't return until
    // indexing completes. On Vercel this keeps the function alive for
    // up to maxDuration (120s). Progress is written to the DB every
    // 2 seconds so the UI's IndexingStatus component can poll it.
    const indexingJob = new IndexingJob();
    await indexingJob.indexArchiveRoot(archiveRootId, auth.userId, dropboxCredentials);

    return NextResponse.json({ message: 'Indexing complete', archiveRootId });
  } catch (error: unknown) {
    console.error('[Indexing] Failed:', error);
    const message = error instanceof Error ? error.message : 'Indexing failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
