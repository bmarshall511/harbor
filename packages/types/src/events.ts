// =============================================================================
// Realtime Event Types
// =============================================================================

export type HarborEventType =
  // File events
  | 'file.created'
  | 'file.updated'
  | 'file.deleted'
  | 'file.moved'
  | 'file.indexed'
  // Folder events
  | 'folder.created'
  | 'folder.updated'
  | 'folder.deleted'
  // Metadata events
  | 'metadata.updated'
  | 'tag.added'
  | 'tag.removed'
  // Relation events
  | 'relation.created'
  | 'relation.deleted'
  // Job events
  | 'job.started'
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  // Preview events
  | 'preview.ready'
  // AI events
  | 'ai.job.started'
  | 'ai.job.completed'
  | 'ai.job.failed'
  // Sync events
  | 'sync.started'
  | 'sync.completed'
  | 'sync.error';

export interface HarborEvent<T = unknown> {
  id: string;
  type: HarborEventType;
  payload: T;
  archiveRootId?: string;
  userId?: string;
  timestamp: string;
}

// Typed event payloads
export interface FileEventPayload {
  fileId: string;
  path: string;
  archiveRootId: string;
  folderId?: string;
}

export interface FolderEventPayload {
  folderId: string;
  path: string;
  archiveRootId: string;
  parentId?: string;
}

export interface MetadataEventPayload {
  entityType: 'FILE' | 'FOLDER';
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface JobEventPayload {
  jobId: string;
  type: string;
  progress?: number;
  error?: string;
}

export interface PreviewReadyPayload {
  fileId: string;
  size: string;
  path: string;
}
