// =============================================================================
// Provider Type Contracts
// =============================================================================

export interface StorageProviderCapabilities {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canMove: boolean;
  canRename: boolean;
  canCreateFolders: boolean;
  canGeneratePreviews: boolean;
  canSearch: boolean;
  canWatch: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mimeType: string | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
  /** Content hash if available from provider during listing (e.g. Dropbox content_hash). */
  hash?: string;
}

export interface FileMetadataResult {
  size: number;
  mimeType: string | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
  hash: string | null;
  width?: number;
  height?: number;
  duration?: number;
}

export interface ChangeEvent {
  type: 'created' | 'modified' | 'deleted' | 'moved';
  path: string;
  oldPath?: string;
  timestamp: Date;
}

export interface SearchResult {
  path: string;
  name: string;
  isDirectory: boolean;
  score?: number;
}

export type ThumbnailSize = 'thumbnail' | 'small' | 'medium' | 'large';

export interface ThumbnailOptions {
  size: ThumbnailSize;
  format?: 'webp' | 'jpg' | 'png';
  quality?: number;
}

export const THUMBNAIL_DIMENSIONS: Record<ThumbnailSize, number> = {
  thumbnail: 200,
  small: 400,
  medium: 800,
  large: 1600,
};

export interface StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: string;

  getCapabilities(): StorageProviderCapabilities;

  // Traversal
  listDirectory(path: string): AsyncGenerator<FileEntry>;
  exists(path: string): Promise<boolean>;

  // Read
  readFile(path: string): Promise<Buffer>;
  readFileStream(path: string): Promise<NodeJS.ReadableStream>;
  getMetadata(path: string): Promise<FileMetadataResult>;

  // Write
  writeFile(path: string, data: Buffer): Promise<void>;
  createFolder(path: string): Promise<void>;

  // Mutations
  deleteFile(path: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  moveFile(from: string, to: string): Promise<void>;
  renameFile(path: string, newName: string): Promise<void>;

  // Hashing
  computeHash?(path: string): Promise<string | null>;

  // Optional capabilities
  watchChanges?(path: string, signal?: AbortSignal): AsyncGenerator<ChangeEvent>;
  search?(query: string, path?: string): AsyncGenerator<SearchResult>;
  getThumbnail?(path: string, options: ThumbnailOptions): Promise<Buffer | null>;
}
