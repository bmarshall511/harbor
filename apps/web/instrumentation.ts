/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * In **local mode**: starts the file watcher and runs dedupe.
 * In **cloud mode**: skips filesystem operations entirely (no
 * file watcher, no local disk access). Dropbox change polling
 * is handled via the `/api/cron/dropbox-sync` cron endpoint.
 */
export async function register() {
  const mode = process.env.HARBOR_DEPLOYMENT_MODE ?? 'local';

  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.HARBOR_PORT || process.env.PORT || 3000;
    const url = `http://localhost:${port}/api/auth/dev-login`;
    console.log('');
    console.log(`  \x1b[36m[Harbor]\x1b[0m Mode: ${mode}`);
    console.log(`  \x1b[36m[Harbor Dev]\x1b[0m Auto-login URL:`);
    console.log(`  \x1b[1m${url}\x1b[0m`);
    console.log('');
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Local mode: start file watcher for local filesystem + Dropbox
    // change poller for remote archives. Cloud mode skips both (no
    // persistent filesystem; Dropbox sync runs via cron).
    if (mode === 'local') {
      try {
        const { fileWatcher, IndexingJob, DropboxSyncService } = await import('@harbor/jobs');
        await fileWatcher.start();

        const { db } = await import('@harbor/database');
        const roots = await db.archiveRoot.findMany({ where: { isActive: true }, select: { id: true } });
        const job = new IndexingJob();
        for (const r of roots) {
          await job.dedupeFolders(r.id).catch((err) => {
            console.error(`[instrumentation] dedupeFolders(${r.id}) failed:`, err);
          });
          await job.dedupeFiles(r.id).catch((err) => {
            console.error(`[instrumentation] dedupeFiles(${r.id}) failed:`, err);
          });
        }

        // Start Dropbox change polling in the background (60s interval).
        // This runs alongside the local file watcher so Dropbox archives
        // also get near-realtime updates when running locally.
        const adminToken = await db.providerToken.findFirst({
          where: { providerType: 'DROPBOX' },
          orderBy: { updatedAt: 'desc' },
          select: { userId: true },
        });
        if (adminToken) {
          // Read Dropbox credentials from the secrets store (DB or env fallback)
          const { getSecret } = await import('@/lib/secrets');
          const appKey = await getSecret('dropbox.appKey');
          const appSecret = await getSecret('dropbox.appSecret');
          const syncService = new DropboxSyncService(
            appKey && appSecret ? { appKey, appSecret } : undefined,
          );
          console.log('[instrumentation] Starting Dropbox change poller (60s interval)');
          // Don't await — runs in the background
          (async () => {
            // Initial sync
            await syncService.syncAll(adminToken.userId).catch((err) => {
              console.error('[DropboxPoller] Initial sync failed:', err);
            });
            // Poll loop
            const interval = setInterval(async () => {
              try {
                await syncService.syncAll(adminToken.userId);
              } catch (err) {
                console.error('[DropboxPoller] Poll failed:', err);
              }
            }, 60_000);
            // Cleanup on process exit
            process.on('SIGTERM', () => clearInterval(interval));
            process.on('SIGINT', () => clearInterval(interval));
          })();
        }
      } catch (err) {
        console.error('[instrumentation] Failed to start services:', err);
      }
    }
  }
}
