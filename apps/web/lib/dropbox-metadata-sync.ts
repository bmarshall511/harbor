/**
 * Dropbox metadata sync — writes .harbor/ metadata JSON files to
 * Dropbox via the API so they're visible on all devices and deployments.
 *
 * The ArchiveMetadataService writes to local disk (or /tmp on Vercel).
 * This module adds a second write to Dropbox so the JSON travels
 * with the archive. When another Harbor instance (local or cloud)
 * indexes the same Dropbox archive, it reads the JSON from Dropbox
 * and picks up all metadata.
 *
 * Flow:
 *   1. ArchiveMetadataService.updateItem() writes to local cache
 *   2. This module reads the JSON from cache and uploads to Dropbox
 *      at {rootPath}/.harbor/items/{uuid}.json and .harbor/index.json
 */

import { db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { getSecret } from '@/lib/secrets';
import { toProviderPath } from '@/lib/provider-paths';

/**
 * Upload a metadata JSON file to Dropbox.
 * Non-blocking, fire-and-forget — failures are logged but don't
 * break the metadata save flow.
 */
export async function syncMetadataToDropbox(
  archiveRootId: string,
  /** Path within .harbor/ — e.g. "items/{uuid}.json" or "index.json" */
  harborRelPath: string,
  /** The JSON content to write */
  content: string,
): Promise<void> {
  try {
    const root = await db.archiveRoot.findUnique({ where: { id: archiveRootId } });
    if (!root || root.providerType !== 'DROPBOX') return;

    const appKey = await getSecret('dropbox.appKey');
    const appSecret = await getSecret('dropbox.appSecret');
    if (!appKey || !appSecret) return;

    // Find the Dropbox token (use the most recently updated one)
    const token = await db.providerToken.findFirst({
      where: { providerType: 'DROPBOX' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!token) return;

    const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
    const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

    const provider = new DropboxProvider('meta-sync', 'MetadataSync', {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? undefined,
      appKey, appSecret, pathRoot,
    });

    // Build the Dropbox path: {rootPath}/.harbor/{harborRelPath}
    const dropboxPath = toProviderPath(
      `.harbor/${harborRelPath}`,
      { providerType: root.providerType, rootPath: root.rootPath },
    );

    await provider.writeFile(dropboxPath, Buffer.from(content, 'utf-8'));
  } catch (err) {
    // Non-fatal — metadata is in the DB regardless
    console.error(`[DropboxMetaSync] Failed to sync ${harborRelPath}:`, err instanceof Error ? err.message : err);
  }
}
