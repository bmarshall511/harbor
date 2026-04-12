import * as path from 'node:path';
import { db, FileRepository, FolderRepository, ArchiveRootRepository, SettingsRepository } from '@harbor/database';
import { LocalFilesystemProvider, DropboxProvider, ArchiveMetadataService } from '@harbor/providers';
import { guessMimeType } from '@harbor/utils';
import { JobManager } from './job-manager';
import { PreviewJob } from './preview-job';
import { toRelativePath } from './path-normalize';
import { fileUpdatePayloadFromJson, syncTagsForFile } from './metadata-sync';
import { metaRootForArchive } from './metadata-root';
import type { StorageProvider } from '@harbor/types';

export class IndexingJob {
  private fileRepo = new FileRepository();
  private folderRepo = new FolderRepository();
  private rootRepo = new ArchiveRootRepository();
  private jobManager = new JobManager();
  private archiveMeta = new ArchiveMetadataService();
  private ignorePatterns: string[] = [];

  // Progress tracking — updated during indexDirectory, periodically
  // flushed to the background_jobs table so the UI can poll it.
  private _jobId: string | null = null;
  private _filesProcessed = 0;
  private _foldersProcessed = 0;
  private _imageCount = 0;
  private _videoCount = 0;
  private _audioCount = 0;
  private _documentCount = 0;
  private _otherCount = 0;
  private _currentPath = '';
  private _lastProgressUpdate = 0;
  private _cancelled = false;
  private _deadline = 0; // 0 = no deadline
  private _interrupted = false;
  private _lastActivityTime = 0;
  private _stuckThresholdMs = 120_000; // 2 minutes without progress = stuck
  private _skipCount = 0; // For chunked continuation: skip this many entries
  private _totalEntriesProcessed = 0; // Entries processed in THIS chunk (for resume)

  /** Set a deadline (epoch ms) after which the job will pause for resumption. */
  setDeadline(deadlineMs: number): void {
    this._deadline = deadlineMs;
  }

  /** Whether the job was interrupted by the deadline (not cancelled). */
  wasInterrupted(): boolean {
    return this._interrupted;
  }

  /** Set how many entries to skip (for chunked continuation). */
  setSkipCount(count: number): void {
    this._skipCount = count;
  }

  /** Get current processing stats. */
  getStats() {
    return {
      jobId: this._jobId,
      filesProcessed: this._filesProcessed,
      foldersProcessed: this._foldersProcessed,
      totalEntriesProcessed: this._totalEntriesProcessed,
      skipCount: this._skipCount,
    };
  }

  async indexArchiveRoot(archiveRootId: string, userId?: string, dropboxCredentials?: { appKey: string; appSecret: string }): Promise<void> {
    const root = await this.rootRepo.findById(archiveRootId);
    if (!root) throw new Error(`Archive root ${archiveRootId} not found`);

    const provider = await this.createProvider(root, userId, dropboxCredentials);
    const jobId = await this.jobManager.enqueue({
      type: 'index',
      metadata: { archiveRootId, providerType: root.providerType },
    });

    try {
      this._jobId = jobId;
      this._filesProcessed = 0;
      this._foldersProcessed = 0;
      this._imageCount = 0;
      this._videoCount = 0;
      this._audioCount = 0;
      this._documentCount = 0;
      this._otherCount = 0;
      this._cancelled = false;
      this._interrupted = false;
      this._lastActivityTime = Date.now();
      this._lastProgressUpdate = Date.now();
      await this.jobManager.markRunning(jobId);

      // Load global ignore patterns from settings
      const settingsRepo = new SettingsRepository();
      const ignoreStr = await settingsRepo.get('indexing.ignorePatterns', '');
      this.ignorePatterns = ignoreStr.split(',').map((p) => p.trim()).filter(Boolean);

      // For Dropbox archives: pull any existing .harbor/index.json from
      // Dropbox into the local cache BEFORE indexing starts. This ensures
      // metadata written by another instance (local or cloud) is picked
      // up and not overwritten with empty defaults.
      if (root.providerType === 'DROPBOX') {
        await this.pullDropboxMetadata(provider, root.id, root.rootPath);
      }

      // Mark the start time so we can clean up stale entries after indexing
      const indexStartTime = new Date();

      if (root.providerType === 'DROPBOX' && 'listAllRecursive' in provider) {
        // Dropbox: use recursive listing (single API call, returns ALL
        // files/folders flat). Much faster than directory-by-directory
        // traversal, and handles large archives without re-traversal.
        const dbxProvider = provider as import('@harbor/providers').DropboxProvider;
        const startPath = root.rootPath === '/' ? '' : root.rootPath;
        // On continuation, skip entries already processed in previous chunks
        const skipCount = this._skipCount;
        await this.indexFlatList(dbxProvider, root.id, root.rootPath, startPath, skipCount);
      } else {
        // Local filesystem: recursive directory walk
        await this.indexDirectory(provider, root.id, root.rootPath, '', null, 0);
      }

      // If cancelled or interrupted by deadline, stop here.
      if (this._cancelled) return;
      if (this._interrupted) {
        const reason = this._deadline > 0 ? 'Vercel timeout — will auto-continue' : 'Watchdog: no activity for 2 minutes';
        const resumeAt = this._skipCount + this._totalEntriesProcessed;
        await this.jobManager.markCompleted(jobId);
        await this.jobManager.updateProgress(jobId, 0.5, {
          archiveRootId,
          filesProcessed: this._filesProcessed,
          foldersProcessed: this._foldersProcessed,
          images: this._imageCount,
          videos: this._videoCount,
          currentPath: this._currentPath,
          interruptReason: reason,
          partial: true,
          resumeAt, // Next chunk should skip this many entries
        }).catch(() => {});
        return;
      }

      // Ensure folder hierarchy exists for all indexed files.
      // Some providers (Dropbox) may not return explicit folder entries,
      // so we derive folders from file paths to guarantee correct hierarchy.
      await this.ensureFolderHierarchy(root.id, root.rootPath);

      // Best-effort dedupe of any pre-existing duplicate folder/file
      // rows left over from older indexer behavior. Idempotent.
      await this.dedupeFolders(root.id);
      await this.dedupeFiles(root.id);

      // Clean up stale entries from previous indexing runs.
      // This code only runs if the traversal completed fully (the
      // interrupted/cancelled checks above return early before here).
      await this.fileRepo.deleteStale(root.id, indexStartTime);
      await this.folderRepo.deleteStale(root.id, indexStartTime);

      // Push updated metadata back to Dropbox (new UUIDs, updated index)
      if (root.providerType === 'DROPBOX') {
        await this.pushDropboxMetadata(provider, root.id, root.rootPath);
      }

      const fileCount = await db.file.count({ where: { archiveRootId: root.id } });
      const folderCount = await db.folder.count({ where: { archiveRootId: root.id } });

      if (fileCount === 0 && folderCount === 0) {
        await this.jobManager.markFailed(jobId, `No files or folders found at path "${root.rootPath}". Check the path and provider connection.`);
      } else {
        await this.jobManager.updateProgress(jobId, 1.0, {
          filesProcessed: this._filesProcessed,
          foldersProcessed: this._foldersProcessed,
          totalFiles: fileCount,
          totalFolders: folderCount,
        });
        await this.jobManager.markCompleted(jobId);

        // Auto-generate preview thumbnails for local archives
        if (root.providerType === 'LOCAL_FILESYSTEM') {
          const settingsRepo = new SettingsRepository();
          const cacheDir = await settingsRepo.get('preview.cacheDir', './data/preview-cache');
          const previewJob = new PreviewJob(cacheDir);
          // Run in background — don't block the indexing response
          previewJob.generateForArchiveRoot(root.id).catch((err) => {
            console.error(`Preview generation failed for ${root.id}:`, err);
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Indexing failed';
      const detail = [
        message,
        `Files processed: ${this._filesProcessed}`,
        `Folders processed: ${this._foldersProcessed}`,
        `Last path: ${this._currentPath || '(none)'}`,
        error instanceof Error && error.stack ? `Stack: ${error.stack.split('\n').slice(0, 3).join(' → ')}` : '',
      ].filter(Boolean).join(' | ');
      console.error(`[IndexingJob] Failed: ${detail}`);
      await this.jobManager.markFailed(jobId, detail);
      throw error;
    }
  }

  /**
   * Re-index a single file: re-stat from disk/provider, re-read its
   * metadata JSON, update the DB row, and regenerate previews.
   */
  async reindexFile(fileId: string, userId?: string, dropboxCredentials?: { appKey: string; appSecret: string }): Promise<void> {
    const file = await db.file.findUnique({
      where: { id: fileId },
      include: { archiveRoot: true },
    });
    if (!file) throw new Error(`File ${fileId} not found`);

    const root = file.archiveRoot;
    const provider = await this.createProvider(root, userId, dropboxCredentials);

    // The local provider resolves paths relative to its root internally,
    // so pass the DB-stored relative path. Dropbox expects a leading slash.
    const providerPath = root.providerType === 'DROPBOX'
      ? `/${file.path}`
      : file.path;

    // Re-stat the file from the provider
    const metadata = await provider.getMetadata(providerPath);
    const mimeType = guessMimeType(file.name) ?? metadata.mimeType;

    // Compute hash if provider supports it
    let hash: string | null = metadata.hash;
    if (!hash && provider.computeHash) {
      try {
        hash = await provider.computeHash(providerPath);
      } catch { /* non-fatal */ }
    }

    // Re-read the Harbor metadata JSON
    const itemMetaRoot = metaRootForArchive(root.id, root.rootPath, provider.type);
    const itemId = file.harborItemId;
    const itemPayload = await this.archiveMeta.readItemByUuid(itemMetaRoot, itemId);

    // Update the DB row
    await db.file.update({
      where: { id: fileId },
      data: {
        mimeType,
        size: metadata.size,
        hash,
        fileCreatedAt: metadata.createdAt,
        fileModifiedAt: metadata.modifiedAt,
        status: 'INDEXED',
        indexedAt: new Date(),
        ...(itemPayload ? fileUpdatePayloadFromJson(itemPayload) : {}),
      },
    });

    // Sync tags
    if (itemPayload) {
      await syncTagsForFile(fileId, itemPayload);
    }

    // Regenerate previews
    if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
      const settingsRepo = new SettingsRepository();
      const cacheDir = await settingsRepo.get('preview.cacheDir', './data/preview-cache');
      const previewJob = new PreviewJob(cacheDir);
      // Delete existing previews so they get regenerated fresh
      await db.preview.deleteMany({ where: { fileId } });
      await previewJob.generatePreviews(fileId).catch((err) => {
        console.error(`[ReindexFile] Preview generation failed for ${fileId}:`, err);
      });
    }

    console.log(`[ReindexFile] Successfully reindexed file ${fileId} (${file.name})`);
  }

  private async createProvider(root: { id: string; name: string; providerType: string; rootPath: string }, userId?: string, dropboxCredentials?: { appKey: string; appSecret: string }): Promise<StorageProvider> {
    if (root.providerType === 'LOCAL_FILESYSTEM') {
      return new LocalFilesystemProvider(root.id, root.name, root.rootPath);
    }

    if (root.providerType === 'DROPBOX') {
      const token = await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', ...(userId ? { userId } : {}) },
        orderBy: { updatedAt: 'desc' },
      });

      if (!token) {
        throw new Error('No Dropbox access token found. Connect Dropbox in Settings first.');
      }

      const appKey = dropboxCredentials?.appKey ?? '';
      const appSecret = dropboxCredentials?.appSecret ?? '';

      // Extract root namespace for team/business account support
      const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
      const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

      const provider = new DropboxProvider(root.id, root.name, {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? undefined,
        appKey,
        appSecret,
        pathRoot,
      });

      // Persist refreshed tokens to DB
      provider.onTokenRefresh = async (newToken, expiresIn) => {
        await db.providerToken.update({
          where: { id: token.id },
          data: {
            accessToken: newToken,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
          },
        });
      };

      return provider;
    }

    throw new Error(`Unsupported provider type: ${root.providerType}`);
  }

  /**
   * Index a Dropbox archive using a flat recursive listing.
   * All files and folders come back in one API call (with pagination).
   * Folders are created on-the-fly as files reference them.
   */
  private async indexFlatList(
    provider: import('@harbor/providers').DropboxProvider,
    archiveRootId: string,
    archiveRootPath: string,
    startPath: string,
    skipCount: number = 0,
  ): Promise<void> {
    let entryIndex = 0;
    try {
      for await (const entry of provider.listAllRecursive(startPath)) {
        // Skip entries already processed in previous chunks
        entryIndex++;
        if (entryIndex <= skipCount) continue;

        this._totalEntriesProcessed++;
        await new Promise<void>((resolve) => setImmediate(resolve));

        if (this._cancelled) return;
        if (this._deadline > 0 && Date.now() >= this._deadline) {
          this._interrupted = true;
          return;
        }
        if (Date.now() - this._lastActivityTime > this._stuckThresholdMs) {
          console.error(`[IndexingJob] Watchdog: no activity for ${this._stuckThresholdMs / 1000}s — aborting`);
          this._interrupted = true;
          return;
        }

        if (this.shouldIgnore(entry.name)) continue;

        const normalizedPath = toRelativePath(entry.path, archiveRootPath);
        if (!normalizedPath) continue;

        // Skip .harbor metadata files/folders (the recursive listing
        // returns them but they're Harbor's internal metadata, not user content)
        if (normalizedPath.includes('.harbor')) continue;

        try {
          if (entry.isDirectory) {
            await this.folderRepo.upsertByPath(archiveRootId, normalizedPath, {
              archiveRoot: { connect: { id: archiveRootId } },
              name: entry.name,
              path: normalizedPath,
              depth: normalizedPath.split('/').length - 1,
            });
            this._foldersProcessed++;
            this._lastActivityTime = Date.now();
          } else {
            const mimeType = guessMimeType(entry.name) ?? entry.mimeType;
            const hash = entry.hash ?? null;

            const itemMetaRoot = metaRootForArchive(archiveRootId, archiveRootPath, provider.type);
            const itemId = await this.archiveMeta.getOrCreateItemId(itemMetaRoot, normalizedPath);
            const existingItem = await this.archiveMeta.readItemByUuid(itemMetaRoot, itemId);

            const baseFile = {
              archiveRoot: { connect: { id: archiveRootId } },
              name: entry.name,
              path: normalizedPath,
              mimeType,
              size: entry.size,
              hash,
              fileCreatedAt: entry.createdAt,
              fileModifiedAt: entry.modifiedAt,
              status: 'INDEXED' as const,
              indexedAt: new Date(),
              harborItemId: itemId,
              ...(existingItem ? fileUpdatePayloadFromJson(existingItem) : {}),
            };

            const file = await this.fileRepo.upsertByPath(archiveRootId, normalizedPath, baseFile);
            this._filesProcessed++;
            this._lastActivityTime = Date.now();
            if (mimeType?.startsWith('image/')) this._imageCount++;
            else if (mimeType?.startsWith('video/')) this._videoCount++;
            else if (mimeType?.startsWith('audio/')) this._audioCount++;
            else if (mimeType?.startsWith('text/') || mimeType === 'application/pdf') this._documentCount++;
            else this._otherCount++;
            this._currentPath = normalizedPath;
            await this._reportProgress();

            if (!existingItem) {
              await this.archiveMeta.updateItem(itemMetaRoot, normalizedPath, {
                name: entry.name, hash: hash ?? undefined,
                createdAt: entry.createdAt, modifiedAt: entry.modifiedAt,
              }, {});
            }
            if (existingItem) {
              await syncTagsForFile(file.id, existingItem);
            }
          }
        } catch (entryError) {
          console.error(`Failed to index ${entry.path}:`, entryError);
        }
      }
    } catch (dirError) {
      throw dirError;
    }
  }

  private async indexDirectory(
    provider: StorageProvider,
    archiveRootId: string,
    archiveRootPath: string,
    dirPath: string,
    parentFolderId: string | null,
    depth: number,
  ): Promise<void> {
    try {
      for await (const entry of provider.listDirectory(dirPath)) {
        // Yield to the event loop so HTTP requests aren't starved
        await new Promise<void>((resolve) => setImmediate(resolve));

        // Abort early if cancelled or deadline reached
        if (this._cancelled) return;
        if (this._deadline > 0 && Date.now() >= this._deadline) {
          this._interrupted = true;
          return;
        }

        // Watchdog: if no file/folder has been processed in 2 minutes,
        // the indexer is likely stuck (e.g. Dropbox API hanging). Abort.
        if (Date.now() - this._lastActivityTime > this._stuckThresholdMs) {
          console.error(`[IndexingJob] Watchdog: no activity for ${this._stuckThresholdMs / 1000}s — aborting`);
          this._interrupted = true;
          return;
        }

        // Skip entries matching global ignore patterns
        if (this.shouldIgnore(entry.name)) continue;

        // Normalize the entry path to a canonical (root-relative,
        // no-leading-slash) form. Without this, providers that
        // return absolute paths (Dropbox: `/My Archive/Photos`)
        // and providers that return relative paths (local FS:
        // `Photos`) write two different rows for the same logical
        // folder, causing the duplicate-folder-in-sidebar bug.
        const normalizedPath = toRelativePath(entry.path, archiveRootPath);
        if (!normalizedPath) continue; // skip the archive root itself

        try {
          if (entry.isDirectory) {
            const folder = await this.folderRepo.upsertByPath(archiveRootId, normalizedPath, {
              archiveRoot: { connect: { id: archiveRootId } },
              name: entry.name,
              path: normalizedPath,
              depth,
              ...(parentFolderId ? { parent: { connect: { id: parentFolderId } } } : {}),
            });

            this._foldersProcessed++;
            this._lastActivityTime = Date.now();

            // Sync folder metadata from .harbor/folders/{path}/meta.json
            // for any provider whose metadata root is a real directory.
            const folderMetaRoot = metaRootForArchive(archiveRootId, archiveRootPath, provider.type);
            const subMeta = await this.archiveMeta.readFolderMeta(folderMetaRoot, normalizedPath);
            if (subMeta.description || subMeta.eventDate || subMeta.location) {
              await this.folderRepo.update(folder.id, {
                description: subMeta.description,
                eventDate: subMeta.eventDate ? new Date(subMeta.eventDate) : undefined,
                location: subMeta.location,
              });
            }

            await this.indexDirectory(provider, archiveRootId, archiveRootPath, entry.path, folder.id, depth + 1);
          } else {
            const mimeType = guessMimeType(entry.name) ?? entry.mimeType;

            // Content hash: use provider-supplied hash if available (Dropbox), else compute
            let hash: string | null = entry.hash ?? null;
            if (!hash && provider.computeHash) {
              try {
                hash = await provider.computeHash(entry.path);
              } catch {
                // Non-fatal: hash computation can fail for unreadable files
              }
            }

            // Resolve (or allocate) the stable Harbor item ID.
            // On Vercel, metadata JSON goes to /tmp (writable, ephemeral).
            const itemMetaRoot = metaRootForArchive(archiveRootId, archiveRootPath, provider.type);
            const itemId = await this.archiveMeta.getOrCreateItemId(itemMetaRoot, normalizedPath);

            // Read whatever metadata already exists so we mirror it
            // into the DB row in the same upsert.
            const existingItem = await this.archiveMeta.readItemByUuid(itemMetaRoot, itemId);
            const itemPayload = existingItem ?? null;

            const baseFile = {
              archiveRoot: { connect: { id: archiveRootId } },
              name: entry.name,
              path: normalizedPath,
              mimeType,
              size: entry.size,
              hash,
              fileCreatedAt: entry.createdAt,
              fileModifiedAt: entry.modifiedAt,
              status: 'INDEXED' as const,
              indexedAt: new Date(),
              harborItemId: itemId,
              ...(parentFolderId ? { folder: { connect: { id: parentFolderId } } } : {}),
              ...(itemPayload ? fileUpdatePayloadFromJson(itemPayload) : {}),
            };

            const file = await this.fileRepo.upsertByPath(archiveRootId, normalizedPath, baseFile);
            this._filesProcessed++;
            this._lastActivityTime = Date.now();
            if (mimeType?.startsWith('image/')) this._imageCount++;
            else if (mimeType?.startsWith('video/')) this._videoCount++;
            else if (mimeType?.startsWith('audio/')) this._audioCount++;
            else if (mimeType?.startsWith('text/') || mimeType === 'application/pdf') this._documentCount++;
            else this._otherCount++;
            this._currentPath = normalizedPath;
            await this._reportProgress();

            // If no JSON existed yet, create a minimal one so other
            // tools can find this file by UUID right away.
            if (!existingItem) {
              await this.archiveMeta.updateItem(
                itemMetaRoot,
                normalizedPath,
                {
                  name: entry.name,
                  hash: hash ?? undefined,
                  createdAt: entry.createdAt,
                  modifiedAt: entry.modifiedAt,
                },
                {},
              );
            }

            // Sync the tag join table from `meta.fields.tags`.
            if (itemPayload) {
              await syncTagsForFile(file.id, itemPayload);
            }
          }
        } catch (entryError) {
          console.error(`Failed to index ${entry.path}:`, entryError);
        }
      }
    } catch (dirError) {
      // For the root directory, propagate the error so the job fails clearly
      if (depth === 0) {
        throw dirError;
      }
      console.error(`Failed to list directory ${dirPath}:`, dirError);
    }
  }

  /**
   * Check if a filename matches any global ignore pattern.
   *
   * Matching is **case-insensitive** (so a user-supplied "Icon" will catch
   * macOS's odd `Icon\r` resource-fork file as well as `icon`, `ICON`, etc.)
   * and supports three pattern shapes:
   *
   *   • exact name        →  `Icon`           matches `Icon`, `icon`, `ICON\r`
   *   • leading wildcard  →  `*.aae`          matches `IMG_1234.AAE`
   *   • trailing wildcard →  `Thumbs*`        matches `Thumbs.db`
   *
   * Whitespace and a trailing carriage return on the candidate are
   * stripped before comparison so resource-fork-style filenames match.
   */
  /**
   * Report indexing progress to the background_jobs table.
   * Throttled to once every 2 seconds to avoid spamming the DB.
   * Stores real counts and the current file path in the job
   * metadata so the UI can show exactly what's happening.
   */
  private async _reportProgress(): Promise<void> {
    if (!this._jobId) return;
    const now = Date.now();
    if (now - this._lastProgressUpdate < 5000) return;
    this._lastProgressUpdate = now;

    // Check if the job was cancelled by the user
    const cancelled = await this.jobManager.isCancelled(this._jobId).catch(() => false);
    if (cancelled) {
      this._cancelled = true;
      return;
    }

    await this.jobManager.updateProgress(this._jobId, 0, {
      filesProcessed: this._filesProcessed,
      foldersProcessed: this._foldersProcessed,
      images: this._imageCount,
      videos: this._videoCount,
      audio: this._audioCount,
      documents: this._documentCount,
      other: this._otherCount,
      currentPath: this._currentPath,
    }).catch(() => {});
  }

  /**
   * Push .harbor/ metadata files TO Dropbox after indexing so other
   * Harbor instances pick up new UUIDs and metadata.
   */
  private async pushDropboxMetadata(
    provider: StorageProvider,
    archiveRootId: string,
    archiveRootPath: string,
  ): Promise<void> {
    const metaRoot = metaRootForArchive(archiveRootId, archiveRootPath, 'remote');
    const fsp = await import('node:fs/promises');
    const pathMod = await import('node:path');

    try {
      const dropboxProvider = provider as import('@harbor/providers').DropboxProvider;

      // Upload index.json
      const indexLocalPath = pathMod.join(metaRoot, '.harbor', 'index.json');
      try {
        const indexData = await fsp.readFile(indexLocalPath);
        const indexDropboxPath = `${archiveRootPath}/.harbor/index.json`.replace(/\/\//g, '/');
        await dropboxProvider.writeFile(indexDropboxPath, Buffer.from(indexData));
      } catch { /* no index to push */ }

      // Upload all item JSONs that were created/updated during this indexing
      const itemsDir = pathMod.join(metaRoot, '.harbor', 'items');
      try {
        const files = await fsp.readdir(itemsDir);
        let pushed = 0;
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = await fsp.readFile(pathMod.join(itemsDir, file));
            const dropboxPath = `${archiveRootPath}/.harbor/items/${file}`.replace(/\/\//g, '/');
            await dropboxProvider.writeFile(dropboxPath, Buffer.from(data));
            pushed++;
          } catch { /* skip individual failures */ }
        }
        if (pushed > 0) {
          console.log(`[Indexing] Pushed ${pushed} metadata files to Dropbox`);
        }
      } catch { /* items dir doesn't exist */ }
    } catch (err) {
      console.error('[Indexing] Failed to push metadata to Dropbox:', err);
    }
  }

  /**
   * Pull .harbor/ metadata files from Dropbox into the local cache
   * before indexing. This ensures metadata written by another Harbor
   * instance is picked up during indexing.
   *
   * Downloads: .harbor/index.json and all .harbor/items/*.json
   */
  private async pullDropboxMetadata(
    provider: StorageProvider,
    archiveRootId: string,
    archiveRootPath: string,
  ): Promise<void> {
    const metaRoot = metaRootForArchive(archiveRootId, archiveRootPath, 'remote');
    const fsp = await import('node:fs/promises');
    const pathMod = await import('node:path');

    // Ensure the cache directories exist
    const itemsDir = pathMod.join(metaRoot, '.harbor', 'items');
    await fsp.mkdir(itemsDir, { recursive: true });

    // Try to read index.json from Dropbox
    try {
      const dropboxProvider = provider as import('@harbor/providers').DropboxProvider;
      const indexDropboxPath = `${archiveRootPath}/.harbor/index.json`.replace(/\/\//g, '/');
      const indexData = await dropboxProvider.readFile(indexDropboxPath);
      await fsp.writeFile(pathMod.join(metaRoot, '.harbor', 'index.json'), indexData);

      // Parse the index to find all item UUIDs
      const index = JSON.parse(indexData.toString('utf-8')) as { paths: Record<string, string> };
      const uuids = [...new Set(Object.values(index.paths ?? {}))];

      // Download each item JSON (batch, max 50 to stay within time limits)
      let downloaded = 0;
      for (const uuid of uuids.slice(0, 200)) {
        try {
          const itemPath = `${archiveRootPath}/.harbor/items/${uuid}.json`.replace(/\/\//g, '/');
          const itemData = await dropboxProvider.readFile(itemPath);
          await fsp.writeFile(pathMod.join(itemsDir, `${uuid}.json`), itemData);
          downloaded++;
        } catch {
          // Item file doesn't exist in Dropbox yet — skip
        }
      }
      if (downloaded > 0) {
        console.log(`[Indexing] Pulled ${downloaded} metadata files from Dropbox`);
      }
    } catch {
      // No .harbor/ in Dropbox yet — first time. That's fine.
      console.log('[Indexing] No existing .harbor/ metadata in Dropbox — starting fresh');
    }
  }

  private shouldIgnore(name: string): boolean {
    const lower = name.replace(/\r$/, '').trim().toLowerCase();
    for (const rawPattern of this.ignorePatterns) {
      const pattern = rawPattern.trim().toLowerCase();
      if (!pattern) continue;
      if (pattern === lower) return true;
      if (pattern.startsWith('*') && lower.endsWith(pattern.slice(1))) return true;
      if (pattern.endsWith('*') && lower.startsWith(pattern.slice(0, -1))) return true;
    }
    return false;
  }

  /**
   * Ensure folder hierarchy exists for all indexed files.
   * Derives folder records from file paths when the provider didn't return
   * explicit folder entries (e.g. Dropbox, or when recursive listing flattened results).
   * Creates any missing folder records and links files to their parent folders.
   */
  private async ensureFolderHierarchy(archiveRootId: string, rootPath: string): Promise<void> {
    const orphanedFiles = await db.file.findMany({
      where: { archiveRootId, folderId: null },
      select: { id: true, path: true, name: true },
    });

    if (orphanedFiles.length === 0) return;

    // Normalize the archive-root prefix so we work in *relative* paths
    // regardless of provider. Dropbox files may arrive with absolute
    // paths like `/My Archive/Photos/img.jpg`; local files arrive
    // already relative like `Photos/img.jpg`. Treating both the same
    // prevents `ensureFolderHierarchy` from synthesizing a phantom
    // top-level folder named after the archive root itself.
    const rootRelative = (rootPath ?? '').replace(/^\/+|\/+$/g, '');

    function toRelative(filePath: string): string {
      const stripped = filePath.replace(/^\/+/, '');
      if (rootRelative && stripped === rootRelative) return '';
      if (rootRelative && stripped.startsWith(rootRelative + '/')) {
        return stripped.slice(rootRelative.length + 1);
      }
      return stripped;
    }

    // Collect all unique folder paths from file paths
    const folderPaths = new Set<string>();
    for (const file of orphanedFiles) {
      const rel = toRelative(file.path);
      if (!rel) continue;
      const parts = rel.split('/').filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join('/');
        // Skip .harbor metadata directories
        if (folderPath.includes('.harbor')) continue;
        folderPaths.add(folderPath);
      }
    }

    if (folderPaths.size === 0) return;

    // Sort by depth (shortest paths first) to create parents before children
    const sortedPaths = Array.from(folderPaths).sort((a, b) =>
      a.split('/').length - b.split('/').length,
    );

    // Create folder records
    const folderIdByPath = new Map<string, string>();

    // Also look up any folders that already exist
    for (const fp of sortedPaths) {
      const existing = await this.folderRepo.findByPath(archiveRootId, fp);
      if (existing) folderIdByPath.set(fp, existing.id);
    }

    for (const folderPath of sortedPaths) {
      if (folderIdByPath.has(folderPath)) continue;

      const parts = folderPath.split('/');
      const name = parts[parts.length - 1];
      if (!name) continue; // Skip empty path segments

      const parentPath = parts.slice(0, -1).join('/');
      const depth = parts.length - 1;
      const parentFolderId = parentPath ? folderIdByPath.get(parentPath) ?? null : null;

      const folder = await this.folderRepo.upsertByPath(archiveRootId, folderPath, {
        archiveRoot: { connect: { id: archiveRootId } },
        name,
        path: folderPath,
        depth,
        ...(parentFolderId ? { parent: { connect: { id: parentFolderId } } } : {}),
      });

      folderIdByPath.set(folderPath, folder.id);
    }

    // Link orphaned files to their parent folders
    let linked = 0;
    for (const file of orphanedFiles) {
      const rel = toRelative(file.path);
      if (!rel) continue;
      const parts = rel.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const parentPath = parts.slice(0, -1).join('/');
      if (parentPath.includes('.harbor')) continue;
      const parentFolderId = folderIdByPath.get(parentPath);
      if (parentFolderId) {
        await this.fileRepo.update(file.id, { folder: { connect: { id: parentFolderId } } });
        linked++;
      }
    }

    if (folderIdByPath.size > 0) {
      console.log(`[IndexingJob] Ensured ${folderIdByPath.size} folders, linked ${linked} files`);
    }
  }

  /**
   * Merge duplicate folder rows for an archive root.
   *
   * Older indexer behavior wrote folder paths in two shapes for
   * Dropbox roots: the absolute provider path (`/My Archive/Photos`)
   * and the canonical relative path (`Photos`). Both pointed at the
   * same physical folder but lived in two distinct DB rows, surfacing
   * as duplicate sidebar entries with split file counts.
   *
   * This pass groups every folder under an archive root by its
   * normalized path, picks the oldest row per group as canonical,
   * repoints any child folders + files at the canonical row, and
   * deletes the leftovers. Idempotent — running it twice is a no-op.
   */
  public async dedupeFolders(archiveRootId: string): Promise<void> {
    // Quick guard: skip if there are no duplicate paths to begin with.
    const groups = await db.$queryRaw<Array<{ path: string; n: number }>>`
      SELECT path, COUNT(*)::int AS n
      FROM folders
      WHERE archive_root_id = ${archiveRootId}::uuid
      GROUP BY path
      HAVING COUNT(*) > 1
      LIMIT 1000
    `;
    if (groups.length === 0) return;

    const dupPaths = groups.map((g) => g.path);
    const rows = await db.folder.findMany({
      where: { archiveRootId, path: { in: dupPaths } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, path: true, parentId: true },
    });

    const byPath = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byPath.get(r.path) ?? [];
      list.push(r);
      byPath.set(r.path, list);
    }

    let merged = 0;
    for (const list of byPath.values()) {
      if (list.length < 2) continue;
      const [keep, ...drop] = list;
      const dropIds = drop.map((d) => d.id);

      // Repoint files and child folders at the survivor.
      await db.file.updateMany({
        where: { folderId: { in: dropIds } },
        data: { folderId: keep.id },
      });
      await db.folder.updateMany({
        where: { parentId: { in: dropIds } },
        data: { parentId: keep.id },
      });
      await db.folder.deleteMany({ where: { id: { in: dropIds } } });
      merged += dropIds.length;
    }

    if (merged > 0) {
      console.log(`[IndexingJob] Merged ${merged} duplicate folder row(s) for archive ${archiveRootId}`);
    }
  }

  /**
   * Same dedupe logic, applied to file rows. Optimized to avoid the
   * O(n) per-row UPDATE storm that older versions used:
   *
   *   1. First, a single `GROUP BY path HAVING count > 1` query to
   *      tell whether there's anything to do at all. If the table
   *      has no duplicate path rows we exit immediately — this
   *      makes startup-time invocation effectively free for healthy
   *      databases (which is the common case after the migration
   *      ran once).
   *
   *   2. Only when duplicates exist do we load the affected paths,
   *      pick a survivor per group, and bulk-delete the losers.
   *
   * The path-canonicalization (rewriting `/My Archive/Photos/x`
   * to `Photos/x`) is intentionally NOT done here. The indexer now
   * writes canonical paths up-front, and forcing a one-time rewrite
   * of every existing row is what produced the prisma query spam.
   * If a stale row still has a non-canonical path it will be
   * normalized on its next reindex.
   */
  public async dedupeFiles(archiveRootId: string): Promise<void> {
    // Quick guard: are there any path collisions at all?
    const groups = await db.$queryRaw<Array<{ path: string; n: number }>>`
      SELECT path, COUNT(*)::int AS n
      FROM files
      WHERE archive_root_id = ${archiveRootId}::uuid
        AND status NOT IN ('DELETED', 'PENDING_DELETE')
      GROUP BY path
      HAVING COUNT(*) > 1
      LIMIT 1000
    `;
    if (groups.length === 0) return;

    const dupPaths = groups.map((g) => g.path);
    const rows = await db.file.findMany({
      where: { archiveRootId, status: { notIn: ['DELETED', 'PENDING_DELETE'] }, path: { in: dupPaths } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, path: true },
    });

    const byPath = new Map<string, string[]>();
    for (const r of rows) {
      const list = byPath.get(r.path) ?? [];
      list.push(r.id);
      byPath.set(r.path, list);
    }

    let merged = 0;
    for (const ids of byPath.values()) {
      if (ids.length < 2) continue;
      const [, ...drop] = ids;
      await db.file.deleteMany({ where: { id: { in: drop } } });
      merged += drop.length;
    }

    if (merged > 0) {
      console.log(`[IndexingJob] Merged ${merged} duplicate file row(s) for archive ${archiveRootId}`);
    }
  }
}
