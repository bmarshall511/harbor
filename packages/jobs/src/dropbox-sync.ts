/**
 * Dropbox change poller — detects file additions, modifications, and
 * deletions in Dropbox archive roots since the last sync.
 *
 * Uses Dropbox's `list_folder/continue` API with a persisted cursor
 * to efficiently fetch only what changed. On first run (no cursor),
 * performs a full `list_folder` to establish the baseline.
 *
 * Works in two deployment contexts:
 *   • **Local mode**: runs as a background loop alongside the file
 *     watcher, polling every 60 seconds.
 *   • **Cloud mode (Vercel)**: triggered via cron endpoint
 *     (`/api/cron/dropbox-sync`) every 15 minutes.
 *
 * Changes are processed synchronously: new files are upserted,
 * deleted files are removed, and the cursor is persisted to the
 * `archive_roots.sync_cursor` column after each successful batch.
 */

import { db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { guessMimeType } from '@harbor/utils';
import { toRelativePath } from './path-normalize';

interface SyncResult {
  archiveRootId: string;
  archiveRootName: string;
  added: number;
  modified: number;
  deleted: number;
  errors: number;
}

export class DropboxSyncService {
  private dropboxCredentials?: { appKey: string; appSecret: string };

  constructor(dropboxCredentials?: { appKey: string; appSecret: string }) {
    this.dropboxCredentials = dropboxCredentials;
  }

  /**
   * Sync all active Dropbox archive roots.
   * Returns a result per root.
   */
  async syncAll(userId: string): Promise<SyncResult[]> {
    const roots = await db.archiveRoot.findMany({
      where: { providerType: 'DROPBOX', isActive: true },
    });

    const results: SyncResult[] = [];
    for (const root of roots) {
      try {
        const result = await this.syncRoot(root, userId);
        results.push(result);
      } catch (err) {
        console.error(`[DropboxSync] Failed to sync "${root.name}":`, err);
        results.push({
          archiveRootId: root.id,
          archiveRootName: root.name,
          added: 0, modified: 0, deleted: 0, errors: 1,
        });
      }
    }
    return results;
  }

  /**
   * Sync a single Dropbox archive root using cursor-based change detection.
   */
  async syncRoot(
    root: { id: string; name: string; rootPath: string; syncCursor: string | null },
    userId: string,
  ): Promise<SyncResult> {
    const provider = await this.buildProvider(userId);
    if (!provider) {
      throw new Error('Dropbox not connected — no provider token found');
    }

    const result: SyncResult = {
      archiveRootId: root.id,
      archiveRootName: root.name,
      added: 0, modified: 0, deleted: 0, errors: 0,
    };

    const rootPathNorm = root.rootPath.replace(/^\/+|\/+$/g, '');

    if (!root.syncCursor) {
      // First sync: get initial cursor by listing the full folder tree.
      // We don't process the entries here — the existing indexer already
      // handles the initial index. We just establish the cursor.
      console.log(`[DropboxSync] First sync for "${root.name}" — establishing cursor`);
      const cursor = await this.getLatestCursor(provider, root.rootPath);
      if (cursor) {
        await db.archiveRoot.update({
          where: { id: root.id },
          data: { syncCursor: cursor, lastSyncedAt: new Date() },
        });
      }
      return result;
    }

    // Subsequent sync: fetch changes since the cursor.
    let cursor = root.syncCursor;
    let hasMore = true;

    while (hasMore) {
      try {
        const client = provider.getClient();
        const res = await client.filesListFolderContinue({ cursor });
        const entries = res.result.entries;

        for (const entry of entries) {
          const entryPath = (entry as { path_display?: string }).path_display ?? (entry as { path_lower?: string }).path_lower ?? '';
          const normalizedPath = toRelativePath(entryPath, root.rootPath);
          if (!normalizedPath) continue; // Skip the root itself

          // Check if this entry is within our root path
          const entryPathNorm = entryPath.replace(/^\/+/, '');
          if (rootPathNorm && !entryPathNorm.toLowerCase().startsWith(rootPathNorm.toLowerCase() + '/') && entryPathNorm.toLowerCase() !== rootPathNorm.toLowerCase()) {
            continue; // Not in our archive root
          }

          try {
            if (entry['.tag'] === 'deleted') {
              // File or folder was deleted
              const existingFile = await db.file.findFirst({
                where: { archiveRootId: root.id, path: normalizedPath },
              });
              if (existingFile) {
                await db.file.delete({ where: { id: existingFile.id } });
                result.deleted++;
              }
              const existingFolder = await db.folder.findFirst({
                where: { archiveRootId: root.id, path: normalizedPath },
              });
              if (existingFolder) {
                await db.folder.delete({ where: { id: existingFolder.id } });
              }
            } else if (entry['.tag'] === 'file') {
              const fileEntry = entry as {
                name: string;
                size: number;
                content_hash?: string;
                client_modified?: string;
                server_modified?: string;
              };

              const mimeType = guessMimeType(fileEntry.name) ?? null;

              // Find parent folder
              const pathParts = normalizedPath.split('/');
              const parentPath = pathParts.slice(0, -1).join('/');
              let folderId: string | null = null;
              if (parentPath) {
                const folder = await db.folder.findFirst({
                  where: { archiveRootId: root.id, path: parentPath },
                });
                folderId = folder?.id ?? null;
              }

              const existing = await db.file.findFirst({
                where: { archiveRootId: root.id, path: normalizedPath },
              });

              if (existing) {
                // Update existing file
                await db.file.update({
                  where: { id: existing.id },
                  data: {
                    name: fileEntry.name,
                    size: fileEntry.size,
                    hash: fileEntry.content_hash ?? existing.hash,
                    mimeType,
                    fileModifiedAt: fileEntry.client_modified ? new Date(fileEntry.client_modified) : undefined,
                    status: 'INDEXED',
                    indexedAt: new Date(),
                  },
                });
                result.modified++;
              } else {
                // Create new file
                await db.file.create({
                  data: {
                    archiveRoot: { connect: { id: root.id } },
                    name: fileEntry.name,
                    path: normalizedPath,
                    mimeType,
                    size: fileEntry.size,
                    hash: fileEntry.content_hash ?? null,
                    status: 'INDEXED',
                    indexedAt: new Date(),
                    fileCreatedAt: fileEntry.client_modified ? new Date(fileEntry.client_modified) : null,
                    fileModifiedAt: fileEntry.client_modified ? new Date(fileEntry.client_modified) : null,
                    ...(folderId ? { folder: { connect: { id: folderId } } } : {}),
                  },
                });
                result.added++;
              }
            } else if (entry['.tag'] === 'folder') {
              const folderEntry = entry as { name: string };

              const existing = await db.folder.findFirst({
                where: { archiveRootId: root.id, path: normalizedPath },
              });
              if (!existing) {
                const depth = normalizedPath.split('/').filter(Boolean).length - 1;
                const parentPath = normalizedPath.split('/').slice(0, -1).join('/');
                let parentId: string | null = null;
                if (parentPath) {
                  const parent = await db.folder.findFirst({
                    where: { archiveRootId: root.id, path: parentPath },
                  });
                  parentId = parent?.id ?? null;
                }
                await db.folder.create({
                  data: {
                    archiveRoot: { connect: { id: root.id } },
                    name: folderEntry.name,
                    path: normalizedPath,
                    depth,
                    ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
                  },
                });
              }
            }
          } catch (err) {
            console.error(`[DropboxSync] Error processing entry "${entryPath}":`, err);
            result.errors++;
          }
        }

        cursor = res.result.cursor;
        hasMore = res.result.has_more;
      } catch (err) {
        console.error(`[DropboxSync] Error fetching changes:`, err);
        result.errors++;
        break;
      }
    }

    // Persist the cursor
    await db.archiveRoot.update({
      where: { id: root.id },
      data: { syncCursor: cursor, lastSyncedAt: new Date() },
    });

    console.log(
      `[DropboxSync] "${root.name}": +${result.added} added, ~${result.modified} modified, -${result.deleted} deleted, ${result.errors} errors`,
    );

    return result;
  }

  /**
   * Get the latest cursor for a Dropbox folder path without processing
   * the entries. Used to establish the initial cursor on first sync.
   */
  private async getLatestCursor(provider: DropboxProvider, rootPath: string): Promise<string | null> {
    try {
      const client = provider.getClient();
      const res = await client.filesListFolderGetLatestCursor({
        path: provider.normalizeDropboxPath(rootPath),
        recursive: true,
        include_deleted: true,
      });
      return res.result.cursor;
    } catch (err) {
      console.error('[DropboxSync] Failed to get latest cursor:', err);
      return null;
    }
  }

  private async buildProvider(userId: string): Promise<DropboxProvider | null> {
    const token = await db.providerToken.findFirst({
      where: { providerType: 'DROPBOX', userId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!token) return null;

    const appKey = this.dropboxCredentials?.appKey ?? '';
    const appSecret = this.dropboxCredentials?.appSecret ?? '';
    const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
    const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

    return new DropboxProvider('sync', 'Sync', {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? undefined,
      appKey, appSecret, pathRoot,
    });
  }
}
