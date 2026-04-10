import { NextResponse } from 'next/server';
import { DropboxSyncService } from '@harbor/jobs';
import { db } from '@harbor/database';
import { getSecret } from '@/lib/secrets';

/**
 * GET /api/cron/dropbox-sync
 *
 * Triggered by Vercel Cron (every 15 minutes in cloud mode) or can
 * be called manually. Syncs all active Dropbox archive roots by
 * fetching changes since the last cursor.
 *
 * On first run for a root, establishes the baseline cursor without
 * processing entries (the initial index is done by the indexer).
 * Subsequent runs only fetch the delta — new, modified, and deleted
 * files since the last sync.
 *
 * Protected by CRON_SECRET in production so only Vercel's cron
 * scheduler (or an admin with the secret) can trigger it.
 */
export const maxDuration = 120;

export async function GET(request: Request) {
  // Verify cron secret in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  }

  // Find the first admin user to use as the Dropbox token owner.
  // In a multi-user setup, the admin who connected Dropbox is the one
  // whose token we use for polling.
  const adminToken = await db.providerToken.findFirst({
    where: { providerType: 'DROPBOX' },
    orderBy: { updatedAt: 'desc' },
    select: { userId: true },
  });

  if (!adminToken) {
    return NextResponse.json({ message: 'No Dropbox connection found', results: [] });
  }

  const appKey = await getSecret('dropbox.appKey');
  const appSecret = await getSecret('dropbox.appSecret');
  const syncService = new DropboxSyncService(
    appKey && appSecret ? { appKey, appSecret } : undefined,
  );
  const results = await syncService.syncAll(adminToken.userId);

  const totalAdded = results.reduce((s, r) => s + r.added, 0);
  const totalModified = results.reduce((s, r) => s + r.modified, 0);
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);

  return NextResponse.json({
    message: `Synced ${results.length} archive roots`,
    totalAdded,
    totalModified,
    totalDeleted,
    results,
  });
}
