import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { lookup } from 'mime-types';
import type {
  StorageProvider,
  StorageProviderCapabilities,
  FileEntry,
  FileMetadataResult,
  ChangeEvent,
  SearchResult,
  ThumbnailOptions,
} from '@harbor/types';

export class LocalFilesystemProvider implements StorageProvider {
  readonly type = 'local';

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly rootPath: string,
  ) {
    if (!path.isAbsolute(rootPath)) {
      throw new Error(`Root path must be absolute: ${rootPath}`);
    }
  }

  getCapabilities(): StorageProviderCapabilities {
    return {
      canRead: true,
      canWrite: true,
      canDelete: true,
      canMove: true,
      canRename: true,
      canCreateFolders: true,
      canGeneratePreviews: true,
      canSearch: true,
      canWatch: true,
    };
  }

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.rootPath, relativePath);
    // Prevent path traversal
    if (!resolved.startsWith(this.rootPath)) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  async *listDirectory(dirPath: string): AsyncGenerator<FileEntry> {
    const fullPath = this.resolvePath(dirPath);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(fullPath, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      // Skip hidden files and system files
      if (entry.name.startsWith('.')) continue;

      const entryPath = path.join(dirPath, entry.name);
      const fullEntryPath = path.join(fullPath, entry.name);

      try {
        const stat = await fsp.stat(fullEntryPath);
        const mimeType = entry.isDirectory() ? null : (lookup(entry.name) || null);

        yield {
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stat.size,
          mimeType,
          createdAt: stat.birthtime,
          modifiedAt: stat.mtime,
        };
      } catch {
        // Skip files we can't stat
        continue;
      }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(this.resolvePath(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    return fsp.readFile(this.resolvePath(filePath));
  }

  async readFileStream(filePath: string): Promise<NodeJS.ReadableStream> {
    return fs.createReadStream(this.resolvePath(filePath));
  }

  async getMetadata(filePath: string): Promise<FileMetadataResult> {
    const fullPath = this.resolvePath(filePath);
    const stat = await fsp.stat(fullPath);
    const mimeType = lookup(filePath) || null;

    return {
      size: stat.size,
      mimeType,
      createdAt: stat.birthtime,
      modifiedAt: stat.mtime,
      hash: null, // Computed separately on demand
    };
  }

  async computeHash(filePath: string): Promise<string | null> {
    const fullPath = this.resolvePath(filePath);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(fullPath);
    await pipeline(stream, hash);
    return hash.digest('hex');
  }

  async writeFile(filePath: string, data: Buffer): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, data);
  }

  async createFolder(folderPath: string): Promise<void> {
    await fsp.mkdir(this.resolvePath(folderPath), { recursive: true });
  }

  async deleteFile(filePath: string): Promise<void> {
    await fsp.unlink(this.resolvePath(filePath));
  }

  async deleteFolder(folderPath: string): Promise<void> {
    await fsp.rm(this.resolvePath(folderPath), { recursive: true });
  }

  async moveFile(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fsp.mkdir(path.dirname(toPath), { recursive: true });
    await fsp.rename(fromPath, toPath);
  }

  async renameFile(filePath: string, newName: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const newPath = path.join(path.dirname(fullPath), newName);
    // Verify newPath is still under root
    if (!newPath.startsWith(this.rootPath)) {
      throw new Error('Path traversal detected');
    }
    await fsp.rename(fullPath, newPath);
  }

  async *watchChanges(dirPath: string, signal?: AbortSignal): AsyncGenerator<ChangeEvent> {
    const fullPath = this.resolvePath(dirPath);
    const watcher = fsp.watch(fullPath, { recursive: true, signal });

    try {
      for await (const event of watcher) {
        if (!event.filename || event.filename.startsWith('.')) continue;

        const eventPath = path.join(dirPath, event.filename);
        const fullEventPath = path.join(fullPath, event.filename);
        let type: ChangeEvent['type'] = 'modified';

        try {
          await fsp.access(fullEventPath);
          // File exists — could be created or modified
          type = event.eventType === 'rename' ? 'created' : 'modified';
        } catch {
          type = 'deleted';
        }

        yield {
          type,
          path: eventPath,
          timestamp: new Date(),
        };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      throw err;
    }
  }

  async *search(query: string, dirPath: string = ''): AsyncGenerator<SearchResult> {
    const lowerQuery = query.toLowerCase();

    for await (const entry of this.listDirectory(dirPath)) {
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        yield {
          path: entry.path,
          name: entry.name,
          isDirectory: entry.isDirectory,
        };
      }

      if (entry.isDirectory) {
        yield* this.search(query, entry.path);
      }
    }
  }
}
