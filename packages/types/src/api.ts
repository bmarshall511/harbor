// =============================================================================
// API Request/Response Contracts
// =============================================================================

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchParams {
  query: string;
  archiveRootIds?: string[];
  folderIds?: string[];
  mimeTypes?: string[];
  tags?: string[];
  people?: string[];           // Filter by person names (from meta.fields.people)
  personId?: string;           // Filter by Face→Person UUID (detected faces)
  adultContent?: string[];     // Filter by adult content labels (meta.fields.adult_content)
  hasFaces?: boolean;          // true = only files with detected faces
  dateFrom?: string;
  dateTo?: string;
  ratingMin?: number;
  ratingMax?: number;
  status?: string[];
  sortBy?: 'relevance' | 'name' | 'date' | 'size' | 'rating';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface SearchFacetsResponse {
  mimeTypes: Array<{ value: string; count: number }>;
  tags: Array<{ id: string; name: string; color: string | null; count: number }>;
  people: Array<{ name: string; count: number }>;
  persons: Array<{ id: string; name: string; faceCount: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
  totalFiles: number;
  totalFolders: number;
}

export interface SearchResponse {
  files: import('./entities.js').FileDto[];
  folders: import('./entities.js').FolderDto[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  facets?: SearchFacetsResponse;
}

export interface SearchLogDto {
  id: string;
  userId: string;
  query: string;
  filters: Record<string, unknown>;
  resultCount: number;
  durationMs: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------

export interface MoveFileRequest {
  fileId: string;
  targetFolderId: string;
}

export interface RenameFileRequest {
  fileId: string;
  newName: string;
}

export interface CreateFolderRequest {
  archiveRootId: string;
  parentId?: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Body shape accepted by `PATCH /api/files/:id`.
 *
 * Routing rules in the handler:
 *   • `title`, `description`, `rating` map to the typed `core.*`
 *     fields on the canonical JSON (and the corresponding DB
 *     mirror columns).
 *   • `tags` is special-cased and mirrored to the FileTag join
 *     table via `syncTagsForFile`.
 *   • Anything else lands in `meta.fields.<key>` — that includes
 *     custom metadata fields like People, Adult Content, EXIF
 *     data, AI fields, caption, altText, etc.
 *
 * Pass arbitrary keys at the top level. There is no separate
 * `customMetadata` bucket — the route partitions automatically.
 */
export interface UpdateFileMetadataRequest {
  title?: string;
  description?: string;
  rating?: number | null;
  tags?: string[];
  // Open shape: any other key lands in `meta.fields.<key>`.
  [field: string]: unknown;
}

export interface UpdateFolderMetadataRequest {
  description?: string;
  eventDate?: string | null;
  location?: string;
  coverFileId?: string | null;
  tags?: string[];
  customMetadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export interface CreateRelationRequest {
  sourceType: import('./entities.js').EntityType;
  sourceId: string;
  targetType: import('./entities.js').EntityType;
  targetId: string;
  relationType: import('./entities.js').RelationType;
  isBidirectional?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: import('./entities.js').UserDto;
  token: string;
  expiresAt: string;
}

export interface RegisterRequest {
  username: string;
  email?: string;
  displayName: string;
  password: string;
}

// ---------------------------------------------------------------------------
// API Error
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
