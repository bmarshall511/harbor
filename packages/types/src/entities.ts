// =============================================================================
// Entity DTOs — Shapes used across the application boundary
// =============================================================================

export type EntityType = 'FILE' | 'FOLDER';

export type RelationType =
  | 'RELATED'
  | 'ALTERNATE_VERSION'
  | 'DERIVED_FROM'
  | 'DUPLICATE_CANDIDATE'
  | 'SAME_EVENT'
  | 'SCAN_OF_SAME_SOURCE'
  | 'CURATED_ASSOCIATION';

export type SystemRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';

export type FileStatus = 'PENDING' | 'INDEXED' | 'ERROR' | 'PENDING_DELETE' | 'DELETED';

export type ArchiveCapability =
  | 'READ'
  | 'WRITE'
  | 'DELETE'
  | 'MOVE'
  | 'RENAME'
  | 'CREATE_FOLDERS'
  | 'SEARCH';

export type ProviderType = 'LOCAL_FILESYSTEM' | 'DROPBOX';

export type PreviewSize = 'THUMBNAIL' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'FULL';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface UserDto {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isActive: boolean;
  isLocalUser: boolean;
  roles: RoleDto[];
}

export interface RoleDto {
  id: string;
  name: string;
  systemRole: SystemRole;
  permissions: PermissionDto[];
}

export interface PermissionDto {
  resource: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Archive Root
// ---------------------------------------------------------------------------

export interface ArchiveRootDto {
  id: string;
  name: string;
  providerType: ProviderType;
  rootPath: string;
  isPrivate: boolean;
  isActive: boolean;
  capabilities: ArchiveCapability[];
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export interface FolderDto {
  id: string;
  archiveRootId: string;
  parentId: string | null;
  name: string;
  path: string;
  depth: number;
  description: string | null;
  eventDate: string | null;
  location: string | null;
  coverFileId: string | null;
  tags: TagDto[];
  childCount?: number;
  fileCount?: number;
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

export interface FileDto {
  // ─── Identity ────────────────────────────────────────────────
  id: string;
  /** Stable Harbor item UUID — matches `.harbor/items/{harborItemId}.json`. */
  harborItemId: string;
  archiveRootId: string;
  folderId: string | null;
  name: string;
  path: string;
  mimeType: string | null;
  size: number;
  hash: string | null;
  status: FileStatus;

  // ─── Filesystem dates ────────────────────────────────────────
  fileCreatedAt: string | null;
  fileModifiedAt: string | null;

  // ─── Indexed metadata (mirrored from the JSON) ───────────────
  // Top-level convenience fields the UI uses for sort/display.
  // Anything beyond these lives in `meta` (untyped).
  title: string | null;
  description: string | null;
  rating: number | null;

  // ─── Full metadata mirror ────────────────────────────────────
  // Mirrors the on-disk `.harbor/items/{uuid}.json`. The shape:
  //   {
  //     core:   { title, description, rating },
  //     fields: { people: [...], adult_content: [...], ... },
  //     system: { path, name, hash, dates, importedAt, updatedAt }
  //   }
  meta: HarborItemMeta;

  // ─── Joins ───────────────────────────────────────────────────
  tags: TagDto[];
  previews: PreviewDto[];
}

export interface HarborItemMeta {
  core: {
    title?: string;
    description?: string;
    rating?: number;
  };
  fields: Record<string, unknown>;
  system?: {
    path: string;
    name: string;
    hash?: string;
    createdAt?: string;
    modifiedAt?: string;
    importedAt: string;
    updatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export interface TagDto {
  id: string;
  name: string;
  color: string | null;
  category: string | null;
  usageCount: number;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewDto {
  id: string;
  fileId: string;
  size: PreviewSize;
  format: string;
  width: number | null;
  height: number | null;
  path: string;
}

// ---------------------------------------------------------------------------
// Entity Relation
// ---------------------------------------------------------------------------

export interface EntityRelationDto {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationType: RelationType;
  isBidirectional: boolean;
  confidence: number | null;
  source: string;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

export interface CommentDto {
  id: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Saved Search
// ---------------------------------------------------------------------------

export interface SavedSearchDto {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Background Job
// ---------------------------------------------------------------------------

export type BackgroundJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface BackgroundJobDto {
  id: string;
  type: string;
  entityType: EntityType | null;
  entityId: string | null;
  status: BackgroundJobStatus;
  progress: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export interface AuditLogDto {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: EntityType;
  entityId: string;
  createdAt: string;
}
