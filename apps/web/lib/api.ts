import type {
  ArchiveRootDto,
  FolderDto,
  FileDto,
  TagDto,
  EntityRelationDto,
  SearchResponse,
  SearchParams,
  UpdateFileMetadataRequest,
  UpdateFolderMetadataRequest,
  CreateRelationRequest,
  BackgroundJobDto,
  AuditLogDto,
  SavedSearchDto,
  CommentDto,
} from '@harbor/types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Archive Roots
export const archiveRoots = {
  list: () => request<ArchiveRootDto[]>('/archive-roots'),
  get: (id: string) => request<ArchiveRootDto>(`/archive-roots/${id}`),
  rename: (id: string, name: string) => request<ArchiveRootDto>(`/archive-roots/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  delete: (id: string) => request<{ removed: { archiveRoot: string; files: number; folders: number; previews: number }; preserved: { sourceFiles: boolean; description: string } }>(`/archive-roots/${id}`, { method: 'DELETE' }),
};

// Folders
export const folders = {
  listChildren: (folderId: string) => request<FolderDto[]>(`/folders/${folderId}/children`),
  listRoot: (archiveRootId: string) =>
    request<FolderDto[]>(`/archive-roots/${archiveRootId}/folders`),
  get: (id: string) => request<FolderDto>(`/folders/${id}`),
  tree: (archiveRootId: string) =>
    request<FolderDto[]>(`/archive-roots/${archiveRootId}/tree`),
  update: (id: string, data: UpdateFolderMetadataRequest) =>
    request<FolderDto>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  create: (archiveRootId: string, parentId: string | null, name: string) =>
    request<FolderDto>('/folders', {
      method: 'POST',
      body: JSON.stringify({ archiveRootId, parentId, name }),
    }),
  delete: (id: string) => request<void>(`/folders/${id}`, { method: 'DELETE' }),
  move: (folderId: string, targetFolderId: string | null) =>
    request<FolderDto>(`/folders/${folderId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetFolderId }),
    }),
};

// Files
export const files = {
  listByFolder: (folderId: string) => request<FileDto[]>(`/folders/${folderId}/files`),
  listByArchiveRoot: (archiveRootId: string) =>
    request<FileDto[]>(`/archive-roots/${archiveRootId}/files`),
  get: (id: string) => request<FileDto>(`/files/${id}`),
  update: (id: string, data: UpdateFileMetadataRequest) =>
    request<FileDto>(`/files/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  /**
   * Mark a file for delete (sends it to the admin delete queue).
   * The file is hidden from listings but the bytes stay on disk
   * until an admin approves the request from the admin page.
   */
  markForDelete: (id: string, reason?: string) =>
    request<{ ok: true; deleteRequestId: string }>(`/files/${id}/delete-request`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? undefined }),
    }),
  move: (fileId: string, targetFolderId: string) =>
    request<FileDto>(`/files/${fileId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetFolderId }),
    }),
  rename: (fileId: string, newName: string) =>
    request<FileDto>(`/files/${fileId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ newName }),
    }),
  cacheStatus: (fileId: string) =>
    request<{
      providerType: string;
      cached: boolean;
      cacheSize: number;
      streamable: boolean;
    }>(`/files/${fileId}/cache`),
  cacheOffline: (fileId: string) =>
    request<{ cached: boolean; cacheSize: number }>(`/files/${fileId}/cache`, { method: 'POST' }),
  clearCache: (fileId: string) =>
    request<{ cached: boolean }>(`/files/${fileId}/cache`, { method: 'DELETE' }),
  getMany: (ids: string[]) => {
    if (ids.length === 0) return Promise.resolve([] as FileDto[]);
    return request<FileDto[]>(`/files/batch?ids=${encodeURIComponent(ids.join(','))}`);
  },
};

// Tags
export const tags = {
  list: (search?: string) => request<TagDto[]>(`/tags${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  search: (query: string) => request<TagDto[]>(`/tags/search?q=${encodeURIComponent(query)}`),
};

// Relations
export const relations = {
  listByEntity: (entityType: string, entityId: string) =>
    request<EntityRelationDto[]>(`/relations?entityType=${entityType}&entityId=${entityId}`),
  create: (data: CreateRelationRequest) =>
    request<EntityRelationDto>('/relations', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/relations/${id}`, { method: 'DELETE' }),
};

// Search
import type { SearchFacetsResponse } from '@harbor/types';

export const search = {
  query: (params: SearchParams & { includeFacets?: boolean }) =>
    request<SearchResponse>('/search', { method: 'POST', body: JSON.stringify(params) }),
  saved: {
    list: () => request<SavedSearchDto[]>('/search/saved'),
    create: (data: { name: string; query: string; filters: Record<string, unknown> }) =>
      request<SavedSearchDto>('/search/saved', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/search/saved/${id}`, { method: 'DELETE' }),
  },
};

// Persons (face-detection based + admin-created)
export const persons = {
  list: () =>
    request<Array<{
      id: string | null;
      name: string | null;
      avatarUrl: string | null;
      entityType: 'PERSON' | 'PET';
      isConfirmed: boolean;
      faceCount: number;
      linkedUser: { id: string; username: string; displayName: string } | null;
      source: 'record' | 'metadata';
      fileCount: number;
    }>>('/persons'),
  create: (name: string, opts?: { linkedUserId?: string; entityType?: 'PERSON' | 'PET' }) =>
    request<{ id: string; name: string }>('/persons', {
      method: 'POST',
      body: JSON.stringify({ name, ...opts }),
    }),
  update: (id: string, data: { name?: string; avatarUrl?: string; linkedUserId?: string; isConfirmed?: boolean; entityType?: 'PERSON' | 'PET' }) =>
    request<{ id: string }>(`/persons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/persons/${id}`, { method: 'DELETE' }),
};

// Person Relationships
export const personRelationships = {
  list: () =>
    request<Array<{
      id: string;
      sourcePersonId: string;
      targetPersonId: string;
      relationType: string;
      label: string | null;
      isBidirectional: boolean;
      sourcePerson: { id: string; name: string | null; avatarUrl: string | null; entityType: string };
      targetPerson: { id: string; name: string | null; avatarUrl: string | null; entityType: string };
    }>>('/person-relationships'),
  create: (data: { sourcePersonId: string; targetPersonId: string; relationType: string; label?: string; isBidirectional?: boolean }) =>
    request<any>('/person-relationships', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { relationType?: string; label?: string; isBidirectional?: boolean }) =>
    request<any>(`/person-relationships/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/person-relationships/${id}`, { method: 'DELETE' }),
};

// Connections graph
export const connections = {
  graph: () =>
    request<{
      nodes: Array<{
        id: string;
        name: string | null;
        avatarUrl: string | null;
        entityType: string;
        faceCount: number;
        relationshipCount: number;
      }>;
      edges: Array<{
        id: string;
        source: string;
        target: string;
        relationType: string;
        label: string | null;
        isBidirectional: boolean;
      }>;
    }>('/connections'),
};

// Face detection
export const faceDetection = {
  run: (opts?: { fileId?: string; archiveRootId?: string; limit?: number }) =>
    request<{ processed: number; facesFound: number }>('/face-detection', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  facesForFile: (fileId: string) =>
    request<Array<{
      id: string;
      fileId: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      confidence: number;
      person: { id: string; name: string | null; avatarUrl: string | null; isConfirmed: boolean } | null;
    }>>(`/files/${fileId}/faces`),
};

// Jobs
export const jobs = {
  list: () => request<BackgroundJobDto[]>('/jobs'),
  get: (id: string) => request<BackgroundJobDto>(`/jobs/${id}`),
};

// Audit
export const audit = {
  recent: (limit?: number) =>
    request<AuditLogDto[]>(`/audit${limit ? `?limit=${limit}` : ''}`),
  byEntity: (entityType: string, entityId: string) =>
    request<AuditLogDto[]>(`/audit?entityType=${entityType}&entityId=${entityId}`),
};

// Comments
export const comments = {
  list: (entityType: string, entityId: string) =>
    request<CommentDto[]>(`/comments?entityType=${entityType}&entityId=${entityId}`),
  create: (entityType: string, entityId: string, body: string) =>
    request<CommentDto>('/comments', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, body }),
    }),
};

// Favorites
export const favorites = {
  list: () => request<Array<{ id: string; entityType: string; entityId: string; createdAt: string }>>('/favorites'),
  expanded: () =>
    request<{ files: FileDto[]; folders: FolderDto[]; total: number }>('/favorites/expanded'),
  toggle: (entityType: string, entityId: string) =>
    request<{ favorited: boolean; id?: string }>('/favorites', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId }),
    }),
};

// Collections
export const collections = {
  list: () => request<Array<{ id: string; name: string; description: string | null; color: string | null; itemCount: number }>>('/collections'),
  get: (id: string) => request<any>(`/collections/${id}`),
  create: (name: string, description?: string, color?: string, isPrivate?: boolean) =>
    request<any>('/collections', { method: 'POST', body: JSON.stringify({ name, description, color, isPrivate }) }),
  update: (id: string, data: { name?: string; description?: string; color?: string }) =>
    request<any>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/collections/${id}`, { method: 'DELETE' }),
  addItem: (id: string, entityType: string, entityId: string) =>
    request<any>(`/collections/${id}/items`, { method: 'POST', body: JSON.stringify({ entityType, entityId }) }),
  removeItem: (id: string, entityType: string, entityId: string) =>
    request<any>(`/collections/${id}/items`, { method: 'DELETE', body: JSON.stringify({ entityType, entityId }) }),
  expanded: (id: string) =>
    request<{
      id: string;
      name: string;
      description: string | null;
      color: string | null;
      isPrivate: boolean;
      files: FileDto[];
      folders: FolderDto[];
      total: number;
    }>(`/collections/${id}/expanded`),
};

// Users (lightweight picker for non-admins)
export const users = {
  picker: () => request<Array<{ id: string; username: string; displayName: string }>>('/users/picker'),
};

// Recommendations
export interface RecommendationItem {
  file: FileDto;
  score: number;
  reasons: string[];
}
export const recommendations = {
  fetch: (params: {
    seedIds: string[];
    scope?: { archiveRootId?: string; folderId?: string };
    limit?: number;
  }) =>
    request<{ items: RecommendationItem[] }>('/recommendations', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};

// Admin: delete queue
export interface DeleteQueueEntry {
  id: string;
  fileId: string | null;
  archiveRootId: string;
  archiveRootName: string;
  providerType: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileMimeType: string | null;
  reason: string | null;
  requestedAt: string;
  requestedBy: { id: string; username: string; displayName: string };
}
export const adminDeleteQueue = {
  list: () =>
    request<{
      pending: DeleteQueueEntry[];
      pendingCount: number;
      pendingBytes: number;
      reclaimedCount: number;
      reclaimedBytes: number;
    }>('/admin/delete-queue'),
  approve: (id: string) =>
    request<{ ok: true; bytesReclaimed: number; providerError: string | null }>(
      `/admin/delete-queue/${id}/approve`,
      { method: 'POST' },
    ),
  reject: (id: string) =>
    request<{ ok: true }>(`/admin/delete-queue/${id}/reject`, { method: 'POST' }),
};

// Preview URL helper
export function getPreviewUrl(fileId: string, size: string = 'thumbnail'): string {
  return `${BASE}/files/${fileId}/preview?size=${size}`;
}

export function getFileDownloadUrl(fileId: string): string {
  return `${BASE}/files/${fileId}/download`;
}
