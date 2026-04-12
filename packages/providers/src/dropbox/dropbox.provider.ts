import type {
  StorageProvider,
  StorageProviderCapabilities,
  FileEntry,
  FileMetadataResult,
  ChangeEvent,
  SearchResult,
  ThumbnailOptions,
} from '@harbor/types';

interface DropboxConfig {
  accessToken: string;
  refreshToken?: string;
  appKey: string;
  appSecret: string;
  /** Root namespace ID for team/business accounts. Sets Dropbox-API-Path-Root header. */
  pathRoot?: string;
}

export class DropboxProvider implements StorageProvider {
  readonly type = 'dropbox';
  private config: DropboxConfig;
  /** Callback to persist a refreshed token */
  onTokenRefresh?: (newAccessToken: string, expiresIn: number) => void;

  constructor(
    readonly id: string,
    readonly name: string,
    config: DropboxConfig,
  ) {
    this.config = config;
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
      canWatch: false,
    };
  }

  getClient() {
    const { Dropbox } = require('dropbox') as typeof import('dropbox');
    return new Dropbox({
      accessToken: this.config.accessToken,
      clientId: this.config.appKey,
      clientSecret: this.config.appSecret,
      pathRoot: this.getPathRootHeader() ?? undefined,
      fetch: globalThis.fetch,
    });
  }

  /** Build the Dropbox-API-Path-Root header value for team/business namespace access. */
  private getPathRootHeader(): string | null {
    if (!this.config.pathRoot) return null;
    return JSON.stringify({ '.tag': 'root', root: this.config.pathRoot });
  }

  /** Common headers for raw fetch calls, including path-root when configured. */
  private getRawHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.accessToken}`,
    };
    const pathRoot = this.getPathRootHeader();
    if (pathRoot) {
      headers['Dropbox-API-Path-Root'] = pathRoot;
    }
    return headers;
  }

  /**
   * Refresh the access token using the refresh token.
   * Updates the internal config so subsequent calls use the new token.
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.config.refreshToken || !this.config.appKey || !this.config.appSecret) {
      throw new Error('Cannot refresh token: missing refresh token or app credentials.');
    }

    const res = await globalThis.fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken,
        client_id: this.config.appKey,
        client_secret: this.config.appSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed: ${text}`);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    this.config.accessToken = data.access_token;

    if (this.onTokenRefresh && data.expires_in) {
      this.onTokenRefresh(data.access_token, data.expires_in);
    }
  }

  normalizeDropboxPath(p: string): string {
    if (!p || p === '/' || p === '') return '';
    return p.startsWith('/') ? p : `/${p}`;
  }

  /**
   * List ALL files and folders recursively from a directory in a single
   * Dropbox API call. Much faster than directory-by-directory traversal
   * for large archives, and avoids re-traversal on restart.
   */
  async *listAllRecursive(dirPath: string): AsyncGenerator<FileEntry> {
    const dbxPath = this.normalizeDropboxPath(dirPath);

    let result;
    try {
      result = await this.getClient().filesListFolder({ path: dbxPath, recursive: true });
    } catch (firstErr: any) {
      const firstSummary = this.extractErrorSummary(firstErr);
      if ((firstSummary.includes('expired_access_token') || firstSummary.includes('invalid_access_token')) && this.config.refreshToken) {
        await this.refreshAccessToken();
        result = await this.getClient().filesListFolder({ path: dbxPath, recursive: true });
      } else {
        throw this.makeDropboxError(firstSummary, dbxPath);
      }
    }

    let hasMore = result!.result.has_more;
    let cursor = result!.result.cursor;
    for (const entry of result!.result.entries) {
      // Use the full Dropbox path from the entry itself (not constructed from parentPath)
      yield this.mapEntryWithFullPath(entry);
    }
    while (hasMore) {
      try {
        const cont = await this.getClient().filesListFolderContinue({ cursor });
        hasMore = cont.result.has_more;
        cursor = cont.result.cursor;
        for (const entry of cont.result.entries) {
          yield this.mapEntryWithFullPath(entry);
        }
      } catch (err: any) {
        const summary = this.extractErrorSummary(err);
        if ((summary.includes('expired_access_token') || summary.includes('invalid_access_token')) && this.config.refreshToken) {
          await this.refreshAccessToken();
          const cont = await this.getClient().filesListFolderContinue({ cursor });
          hasMore = cont.result.has_more;
          cursor = cont.result.cursor;
          for (const entry of cont.result.entries) {
            yield this.mapEntryWithFullPath(entry);
          }
        } else if (err?.status === 429 || summary.includes('too_many_requests')) {
          console.warn('[Dropbox] Rate limited, waiting 30s...');
          await new Promise((r) => setTimeout(r, 30_000));
          const cont = await this.getClient().filesListFolderContinue({ cursor });
          hasMore = cont.result.has_more;
          cursor = cont.result.cursor;
          for (const entry of cont.result.entries) {
            yield this.mapEntryWithFullPath(entry);
          }
        } else {
          console.error('[Dropbox] Recursive listing pagination failed:', summary);
          break;
        }
      }
    }
  }

  private mapEntryWithFullPath(entry: any): FileEntry {
    const isDir = entry['.tag'] === 'folder';
    return {
      name: entry.name,
      path: entry.path_display ?? entry.path_lower ?? entry.name,
      isDirectory: isDir,
      size: isDir ? 0 : (entry.size ?? 0),
      mimeType: null,
      createdAt: null,
      modifiedAt: entry.client_modified ? new Date(entry.client_modified) : null,
      hash: isDir ? undefined : (entry.content_hash ?? undefined),
    };
  }

  async *listDirectory(dirPath: string): AsyncGenerator<FileEntry> {
    const dbxPath = this.normalizeDropboxPath(dirPath);

    let result;
    try {
      result = await this.getClient().filesListFolder({ path: dbxPath });
    } catch (firstErr: any) {
      const firstSummary = this.extractErrorSummary(firstErr);

      // Auto-refresh on expired token and retry once
      if ((firstSummary.includes('expired_access_token') || firstSummary.includes('invalid_access_token')) && this.config.refreshToken) {
        try {
          await this.refreshAccessToken();
          result = await this.getClient().filesListFolder({ path: dbxPath });
        } catch (refreshErr: any) {
          const summary = this.extractErrorSummary(refreshErr);
          throw this.makeDropboxError(summary, dbxPath);
        }
      } else {
        throw this.makeDropboxError(firstSummary, dbxPath);
      }
    }

    let hasMore = result!.result.has_more;
    let cursor = result!.result.cursor;
    for (const entry of result!.result.entries) {
      yield this.mapEntry(entry, dirPath);
    }
    while (hasMore) {
      try {
        const cont = await this.getClient().filesListFolderContinue({ cursor });
        hasMore = cont.result.has_more;
        cursor = cont.result.cursor;
        for (const entry of cont.result.entries) {
          yield this.mapEntry(entry, dirPath);
        }
      } catch (err: any) {
        const summary = this.extractErrorSummary(err);
        // Retry once on expired token
        if ((summary.includes('expired_access_token') || summary.includes('invalid_access_token')) && this.config.refreshToken) {
          await this.refreshAccessToken();
          const cont = await this.getClient().filesListFolderContinue({ cursor });
          hasMore = cont.result.has_more;
          cursor = cont.result.cursor;
          for (const entry of cont.result.entries) {
            yield this.mapEntry(entry, dirPath);
          }
        } else if (err?.status === 429 || summary.includes('too_many_requests')) {
          // Rate limited — wait and retry
          console.warn('[Dropbox] Rate limited during listDirectory pagination, waiting 30s...');
          await new Promise((r) => setTimeout(r, 30_000));
          const cont = await this.getClient().filesListFolderContinue({ cursor });
          hasMore = cont.result.has_more;
          cursor = cont.result.cursor;
          for (const entry of cont.result.entries) {
            yield this.mapEntry(entry, dirPath);
          }
        } else {
          console.error('[Dropbox] listDirectory pagination failed:', summary);
          break; // Stop paginating this directory but don't crash the whole indexer
        }
      }
    }
  }

  private extractErrorSummary(err: any): string {
    const errBody = err?.error;
    if (typeof errBody === 'object' && errBody !== null) {
      return errBody.error_summary || errBody.error?.['.tag'] || '';
    }
    return typeof errBody === 'string' ? errBody : (err?.message || '');
  }

  private makeDropboxError(summary: string, dbxPath: string): Error {
    if (summary.includes('missing_scope')) {
      return new Error(
        `Dropbox app is missing required permissions. Go to Dropbox App Console → Permissions tab and enable: files.metadata.read, files.content.read, files.content.write. Then Reconnect Dropbox in Harbor settings to get a fresh token with the new scopes.`
      );
    }
    if (summary.includes('not_found') || summary.includes('path/not_found')) {
      return new Error(
        `Dropbox path "${dbxPath || '/'}" not found. Use a Dropbox-relative path (e.g. /Photos), not a local filesystem path.`
      );
    }
    if (summary.includes('invalid_access_token') || summary.includes('expired_access_token')) {
      return new Error(`Dropbox token is invalid or expired. Reconnect Dropbox in Harbor settings.`);
    }
    return new Error(`Dropbox error: ${summary || 'Unknown error'}`);
  }

  private mapEntry(entry: any, parentPath: string): FileEntry {
    const isDir = entry['.tag'] === 'folder';
    return {
      name: entry.name,
      path: parentPath ? `${parentPath}/${entry.name}` : entry.name,
      isDirectory: isDir,
      size: isDir ? 0 : (entry.size ?? 0),
      mimeType: null, // Dropbox doesn't return MIME directly; infer from extension
      createdAt: null,
      modifiedAt: entry.client_modified ? new Date(entry.client_modified) : null,
      hash: isDir ? undefined : (entry.content_hash ?? undefined),
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.filesGetMetadata({ path: this.normalizeDropboxPath(filePath) });
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    return this.withRefresh(async () => {
      const normalizedPath = this.normalizeDropboxPath(filePath);
      const arg = JSON.stringify({ path: normalizedPath });
      // Use raw fetch: the Dropbox SDK's res.buffer() is incompatible with native fetch
      const res = await globalThis.fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          ...this.getRawHeaders(),
          'Dropbox-API-Arg': arg,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        // Dropbox errors come back as JSON like
        //   {"error_summary":"path/not_found/...","error":{".tag":"path",...}}
        // Surface the human-readable summary plus the path we asked
        // for so the caller (and the user-facing toast) can tell at a
        // glance whether the path was wrong vs. permissions vs. quota.
        let pretty = text;
        try {
          const parsed = JSON.parse(text) as { error_summary?: string };
          if (parsed.error_summary) {
            pretty = parsed.error_summary.replace(/\/+$/, '');
          }
        } catch { /* not JSON */ }
        throw new Error(
          `Dropbox could not download "${normalizedPath}" (status ${res.status}): ${pretty}`,
        );
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    });
  }

  /** Execute a Dropbox API call with automatic token refresh on auth errors. */
  async withRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const summary = this.extractErrorSummary(err);
      if ((summary.includes('expired_access_token') || summary.includes('invalid_access_token')) && this.config.refreshToken) {
        await this.refreshAccessToken();
        return fn();
      }
      throw err;
    }
  }

  async readFileStream(filePath: string): Promise<NodeJS.ReadableStream> {
    // Dropbox SDK doesn't natively support streaming; read full file
    const buf = await this.readFile(filePath);
    const { Readable } = require('node:stream') as typeof import('node:stream');
    return Readable.from(buf);
  }

  async getMetadata(filePath: string): Promise<FileMetadataResult> {
    const client = this.getClient();
    const result = await client.filesGetMetadata({ path: this.normalizeDropboxPath(filePath) });
    const meta = result.result as any;
    return {
      size: meta.size ?? 0,
      mimeType: null,
      createdAt: null,
      modifiedAt: meta.client_modified ? new Date(meta.client_modified) : null,
      hash: meta.content_hash ?? null,
    };
  }

  async writeFile(filePath: string, data: Buffer): Promise<void> {
    const client = this.getClient();
    await client.filesUpload({
      path: this.normalizeDropboxPath(filePath),
      contents: data,
      mode: { '.tag': 'overwrite' },
    });
  }

  async createFolder(folderPath: string): Promise<void> {
    const client = this.getClient();
    await client.filesCreateFolderV2({ path: this.normalizeDropboxPath(folderPath) });
  }

  async deleteFile(filePath: string): Promise<void> {
    const client = this.getClient();
    await client.filesDeleteV2({ path: this.normalizeDropboxPath(filePath) });
  }

  async deleteFolder(folderPath: string): Promise<void> {
    const client = this.getClient();
    await client.filesDeleteV2({ path: this.normalizeDropboxPath(folderPath) });
  }

  async moveFile(from: string, to: string): Promise<void> {
    const client = this.getClient();
    await client.filesMoveV2({
      from_path: this.normalizeDropboxPath(from),
      to_path: this.normalizeDropboxPath(to),
    });
  }

  async renameFile(filePath: string, newName: string): Promise<void> {
    const parts = filePath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    await this.moveFile(filePath, newPath);
  }

  async *search(query: string, dirPath?: string): AsyncGenerator<SearchResult> {
    const client = this.getClient();
    const result = await client.filesSearchV2({
      query,
      options: dirPath ? { path: this.normalizeDropboxPath(dirPath) } : undefined,
    });

    for (const match of result.result.matches) {
      const meta = (match.metadata as any)?.metadata;
      if (!meta) continue;
      yield {
        path: meta.path_display ?? meta.name,
        name: meta.name,
        isDirectory: meta['.tag'] === 'folder',
      };
    }
  }

  async computeHash(filePath: string): Promise<string | null> {
    const meta = await this.getMetadata(filePath);
    return meta.hash;
  }

  async getThumbnail(filePath: string, options: ThumbnailOptions): Promise<Buffer | null> {
    try {
      return await this.withRefresh(async () => {
        const sizeMap: Record<string, string> = {
          thumbnail: 'w128h128',
          small: 'w256h256',
          medium: 'w480h320',
          large: 'w1024h768',
        };
        const arg = JSON.stringify({
          resource: { '.tag': 'path', path: this.normalizeDropboxPath(filePath) },
          size: { '.tag': sizeMap[options.size] ?? 'w256h256' },
          format: { '.tag': 'jpeg' },
        });
        // Use raw fetch: the Dropbox SDK's res.buffer() is incompatible with native fetch
        const res = await globalThis.fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
          method: 'POST',
          headers: {
            ...this.getRawHeaders(),
            'Dropbox-API-Arg': arg,
          },
        });
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
      });
    } catch {
      return null;
    }
  }
}
