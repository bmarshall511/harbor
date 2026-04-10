import { db, FileRepository, FolderRepository, ArchiveRootRepository, SettingsRepository } from '@harbor/database';
import { LocalFilesystemProvider, ArchiveMetadataService } from '@harbor/providers';
import { eventBus } from '@harbor/realtime';
import { guessMimeType } from '@harbor/utils';
import { PreviewJob } from './preview-job';
import { fileUpdatePayloadFromJson, syncTagsForFile } from './metadata-sync';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

interface WatcherHandle {
  archiveRootId: string;
  rootPath: string;
  abort: AbortController;
}

/**
 * FileWatcherService manages filesystem watchers for active local archive roots.
 *
 * It debounces events, performs incremental file/folder upserts and deletes,
 * and emits realtime events so the UI updates without manual refresh.
 *
 * Local-filesystem only — Dropbox uses its own change notification model.
 */
export class FileWatcherService {
  private watchers = new Map<string, WatcherHandle>();
  private fileRepo = new FileRepository();
  private folderRepo = new FolderRepository();
  private rootRepo = new ArchiveRootRepository();
  private archiveMeta = new ArchiveMetadataService();
  private started = false;

  /** Debounce map: relative path -> timer. Coalesces rapid events on the same path. */
  private pending = new Map<string, NodeJS.Timeout>();
  private static readonly DEBOUNCE_MS = 500;

  /** Prevent re-entrant processing of the same path. */
  private processing = new Set<string>();

  /**
   * Start watchers for all active local archive roots.
   * Safe to call multiple times — only starts once.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      const roots = await this.rootRepo.findAll();
      const localRoots = roots.filter(
        (r) => r.providerType === 'LOCAL_FILESYSTEM' && r.isActive,
      );

      for (const root of localRoots) {
        this.watchRoot(root.id, root.rootPath);
      }

      if (localRoots.length > 0) {
        console.log(`[FileWatcher] Watching ${localRoots.length} local archive root(s)`);
      }
    } catch (err) {
      console.error('[FileWatcher] Failed to start:', err);
      this.started = false;
    }
  }

  /** Start watching a single archive root. */
  watchRoot(archiveRootId: string, rootPath: string): void {
    if (this.watchers.has(archiveRootId)) return;

    const abort = new AbortController();
    const handle: WatcherHandle = { archiveRootId, rootPath, abort };
    this.watchers.set(archiveRootId, handle);

    this.runWatcher(handle).catch((err) => {
      // Only log if it wasn't intentionally aborted
      if (err?.name !== 'AbortError') {
        console.error(`[FileWatcher] Watcher failed for ${archiveRootId}:`, err);
      }
      this.watchers.delete(archiveRootId);
    });
  }

  /** Stop watching a single archive root. */
  unwatchRoot(archiveRootId: string): void {
    const handle = this.watchers.get(archiveRootId);
    if (handle) {
      handle.abort.abort();
      this.watchers.delete(archiveRootId);
    }
  }

  /** Stop all watchers and reset state. */
  stopAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchRoot(id);
    }
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.processing.clear();
    this.started = false;
  }

  /** Get list of currently watched archive root IDs. */
  getWatchedRoots(): string[] {
    return Array.from(this.watchers.keys());
  }

  private async runWatcher(handle: WatcherHandle): Promise<void> {
    const provider = new LocalFilesystemProvider(
      handle.archiveRootId,
      'watcher',
      handle.rootPath,
    );

    // Load ignore patterns (lowercased once, shared with the index job)
    const settingsRepo = new SettingsRepository();
    const ignoreStr = await settingsRepo.get('indexing.ignorePatterns', '');
    const patterns = ignoreStr
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    function matchesIgnore(fileName: string): boolean {
      const lower = fileName.replace(/\r$/, '').trim().toLowerCase();
      for (const pattern of patterns) {
        if (pattern === lower) return true;
        if (pattern.startsWith('*') && lower.endsWith(pattern.slice(1))) return true;
        if (pattern.endsWith('*') && lower.startsWith(pattern.slice(0, -1))) return true;
      }
      return false;
    }

    for await (const event of provider.watchChanges!('', handle.abort.signal)) {
      // Skip .harbor metadata directory changes to avoid loops
      if (event.path.includes('.harbor')) continue;

      // Skip globally ignored files (case-insensitive, supports * wildcards)
      const fileName = event.path.split('/').pop() ?? '';
      if (matchesIgnore(fileName)) continue;

      this.debounce(handle, event.path, event.type);
    }
  }

  /**
   * Debounce filesystem events. Multiple rapid events on the same path
   * (e.g. write → rename during save) are coalesced into a single processing call.
   */
  private debounce(
    handle: WatcherHandle,
    relativePath: string,
    eventType: 'created' | 'modified' | 'deleted' | 'moved',
  ): void {
    const key = `${handle.archiveRootId}:${relativePath}`;

    // Clear any pending timer for this path
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.processChange(handle, relativePath).catch((err) => {
        console.error(`[FileWatcher] Error processing ${relativePath}:`, err);
      });
    }, FileWatcherService.DEBOUNCE_MS);

    this.pending.set(key, timer);
  }

  /**
   * Process a single debounced filesystem change.
   * Determines whether the path is a file or folder, whether it was
   * created/modified/deleted, and performs the appropriate DB + event operations.
   */
  private async processChange(
    handle: WatcherHandle,
    relativePath: string,
  ): Promise<void> {
    const key = `${handle.archiveRootId}:${relativePath}`;
    if (this.processing.has(key)) return;
    this.processing.add(key);

    try {
      const fullPath = path.resolve(handle.rootPath, relativePath);

      // Safety: verify the path is under the root
      if (!fullPath.startsWith(handle.rootPath)) return;

      let exists = false;
      let stat: Awaited<ReturnType<typeof fsp.stat>> | null = null;
      try {
        stat = await fsp.stat(fullPath);
        exists = true;
      } catch {
        exists = false;
      }

      if (exists && stat) {
        if (stat.isDirectory()) {
          await this.handleFolderChange(handle, relativePath, stat);
        } else {
          await this.handleFileChange(handle, relativePath, stat);
        }
      } else {
        await this.handleDeletion(handle, relativePath);
      }
    } finally {
      this.processing.delete(key);
    }
  }

  /**
   * Handle a folder being created or modified on disk.
   */
  private async handleFolderChange(
    handle: WatcherHandle,
    relativePath: string,
    _stat: Awaited<ReturnType<typeof fsp.stat>>,
  ): Promise<void> {
    const folderName = path.basename(relativePath);
    const parentPath = path.dirname(relativePath);

    // Find parent folder
    let parentFolderId: string | null = null;
    if (parentPath && parentPath !== '.') {
      const parentFolder = await this.folderRepo.findByPath(handle.archiveRootId, parentPath);
      parentFolderId = parentFolder?.id ?? null;
    }

    const depth = relativePath.split(path.sep).length - 1;

    const folder = await this.folderRepo.upsertByPath(handle.archiveRootId, relativePath, {
      archiveRoot: { connect: { id: handle.archiveRootId } },
      name: folderName,
      path: relativePath,
      depth,
      ...(parentFolderId ? { parent: { connect: { id: parentFolderId } } } : {}),
    });

    // Sync folder metadata from .harbor/meta.json
    const subMeta = await this.archiveMeta.readFolderMeta(handle.rootPath, relativePath);
    if (subMeta.description || subMeta.eventDate || subMeta.location) {
      await this.folderRepo.update(folder.id, {
        description: subMeta.description,
        eventDate: subMeta.eventDate ? new Date(subMeta.eventDate) : undefined,
        location: subMeta.location,
      });
    }

    eventBus.emit('folder.created', {
      folderId: folder.id,
      path: relativePath,
      archiveRootId: handle.archiveRootId,
      parentId: parentFolderId,
    }, { archiveRootId: handle.archiveRootId });
  }

  /**
   * Handle a file being created or modified on disk.
   */
  private async handleFileChange(
    handle: WatcherHandle,
    relativePath: string,
    stat: Awaited<ReturnType<typeof fsp.stat>>,
  ): Promise<void> {
    const fileName = path.basename(relativePath);
    const parentPath = path.dirname(relativePath);
    const mimeType = guessMimeType(fileName) ?? null;

    // Find parent folder
    let parentFolderId: string | null = null;
    if (parentPath && parentPath !== '.') {
      const parentFolder = await this.folderRepo.findByPath(handle.archiveRootId, parentPath);
      parentFolderId = parentFolder?.id ?? null;
    }

    // Compute content hash
    let hash: string | null = null;
    const provider = new LocalFilesystemProvider(handle.archiveRootId, 'hash', handle.rootPath);
    try {
      hash = await provider.computeHash!(relativePath);
    } catch {
      // Non-fatal
    }

    // Check if file already existed (update vs create)
    const existingFile = await this.fileRepo.findByPath(handle.archiveRootId, relativePath);

    // Resolve the stable Harbor item UUID and read any existing
    // metadata from the on-disk JSON. If no JSON exists yet, the
    // file row gets a fresh UUID and an empty `meta` mirror.
    const itemId = await this.archiveMeta.getOrCreateItemId(handle.rootPath, relativePath);
    const itemPayload = await this.archiveMeta.readItemByUuid(handle.rootPath, itemId);

    const file = await this.fileRepo.upsertByPath(handle.archiveRootId, relativePath, {
      archiveRoot: { connect: { id: handle.archiveRootId } },
      name: fileName,
      path: relativePath,
      mimeType,
      size: stat.size,
      hash,
      fileCreatedAt: stat.birthtime,
      fileModifiedAt: stat.mtime,
      status: 'INDEXED',
      indexedAt: new Date(),
      harborItemId: itemId,
      ...(parentFolderId ? { folder: { connect: { id: parentFolderId } } } : {}),
      ...(itemPayload ? fileUpdatePayloadFromJson(itemPayload) : {}),
    });

    // Sync the tag join table from JSON.
    if (itemPayload) {
      await syncTagsForFile(file.id, itemPayload);
    } else {
      // First sighting — write a minimal JSON so external tools can
      // find the file by UUID immediately.
      await this.archiveMeta.updateItem(
        handle.rootPath,
        relativePath,
        {
          name: fileName,
          hash: hash ?? undefined,
          createdAt: stat.birthtime,
          modifiedAt: stat.mtime,
        },
        {},
      );
    }

    const eventType = existingFile ? 'file.updated' : 'file.created';
    eventBus.emit(eventType, {
      fileId: file.id,
      path: relativePath,
      archiveRootId: handle.archiveRootId,
      folderId: parentFolderId,
    }, { archiveRootId: handle.archiveRootId });

    // Generate preview for new/updated image and video files
    if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) {
      try {
        const settingsRepo = new SettingsRepository();
        const cacheDir = await settingsRepo.get('preview.cacheDir', './data/preview-cache');
        const previewJob = new PreviewJob(cacheDir);
        await previewJob.generatePreviews(file.id);
        eventBus.emit('preview.ready', {
          fileId: file.id,
          size: 'THUMBNAIL',
          path: relativePath,
        }, { archiveRootId: handle.archiveRootId });
      } catch {
        // Non-fatal: preview generation failure shouldn't block the watcher
      }
    }
  }

  /**
   * Handle a file or folder being deleted from disk.
   */
  private async handleDeletion(
    handle: WatcherHandle,
    relativePath: string,
  ): Promise<void> {
    // Try to find and remove as file first
    const file = await this.fileRepo.findByPath(handle.archiveRootId, relativePath);
    if (file) {
      // Bytes are gone from disk → hard-delete the row.
      await this.fileRepo.hardDelete(file.id);
      eventBus.emit('file.deleted', {
        fileId: file.id,
        path: relativePath,
        archiveRootId: handle.archiveRootId,
        folderId: file.folderId,
      }, { archiveRootId: handle.archiveRootId });
      return;
    }

    // Try as folder
    const folder = await this.folderRepo.findByPath(handle.archiveRootId, relativePath);
    if (folder) {
      // Soft-delete all files in this folder tree first
      const childFiles = await db.file.findMany({
        where: { archiveRootId: handle.archiveRootId, path: { startsWith: relativePath + '/' } },
        select: { id: true, path: true, folderId: true },
      });
      for (const cf of childFiles) {
        await this.fileRepo.hardDelete(cf.id);
        eventBus.emit('file.deleted', {
          fileId: cf.id,
          path: cf.path,
          archiveRootId: handle.archiveRootId,
          folderId: cf.folderId,
        }, { archiveRootId: handle.archiveRootId });
      }

      // Delete child folders then this folder
      await db.folder.deleteMany({
        where: { archiveRootId: handle.archiveRootId, path: { startsWith: relativePath + '/' } },
      });
      await this.folderRepo.delete(folder.id);

      eventBus.emit('folder.deleted', {
        folderId: folder.id,
        path: relativePath,
        archiveRootId: handle.archiveRootId,
        parentId: folder.parentId,
      }, { archiveRootId: handle.archiveRootId });
    }
  }
}

/** Singleton instance for the application. */
export const fileWatcher = new FileWatcherService();
