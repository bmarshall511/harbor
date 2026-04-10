export interface JobDefinition {
  type: string;
  entityType?: 'FILE' | 'FOLDER';
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface JobProgress {
  jobId: string;
  progress: number; // 0-1
  message?: string;
}
