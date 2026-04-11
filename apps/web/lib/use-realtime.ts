'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { HarborEvent } from '@harbor/types';

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting';

/**
 * SSE consumer that listens for server events and invalidates
 * relevant React Query caches to keep the UI live.
 *
 * Returns the connection status so the UI can show reconnection state.
 */
export function useRealtime(): RealtimeStatus {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onopen = () => setStatus('connected');

    function handleEvent(raw: MessageEvent) {
      try {
        const event: HarborEvent = JSON.parse(raw.data);
        invalidateForEvent(event);
      } catch {
        // Ignore malformed events
      }
    }

    function invalidateForEvent(event: HarborEvent) {
      const type = event.type;
      const payload = event.payload as Record<string, unknown>;

      // File events → invalidate file queries
      if (type.startsWith('file.')) {
        queryClient.invalidateQueries({ queryKey: ['files'] });
        // Anything that surfaces file lists should refetch.
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['recommendations'] });
        queryClient.invalidateQueries({ queryKey: ['recently-viewed'] });
        if (payload.fileId) {
          queryClient.invalidateQueries({ queryKey: ['file', payload.fileId] });
          queryClient.invalidateQueries({ queryKey: ['file-cache', payload.fileId] });
        }
        if (payload.folderId) {
          queryClient.invalidateQueries({ queryKey: ['files', 'folder', payload.folderId] });
        }
        if (payload.archiveRootId) {
          queryClient.invalidateQueries({ queryKey: ['files', 'root', payload.archiveRootId] });
        }
      }

      // Folder events → invalidate folder queries
      if (type.startsWith('folder.')) {
        queryClient.invalidateQueries({ queryKey: ['folders'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        if (payload.folderId) {
          queryClient.invalidateQueries({ queryKey: ['folder', payload.folderId] });
        }
      }

      // Metadata events — invalidate both the individual file/folder
      // AND the list queries that embed file data (recommendations,
      // recently viewed, dashboard, file listings) so title/tag/people
      // changes show up immediately across all cards.
      if (type === 'metadata.updated') {
        if (payload.entityType === 'FILE' && payload.entityId) {
          queryClient.invalidateQueries({ queryKey: ['file', payload.entityId] });
        }
        if (payload.entityType === 'FOLDER' && payload.entityId) {
          queryClient.invalidateQueries({ queryKey: ['folder', payload.entityId] });
        }
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['recommendations'] });
        queryClient.invalidateQueries({ queryKey: ['recently-viewed'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }

      // Tag events
      if (type === 'tag.added' || type === 'tag.removed') {
        queryClient.invalidateQueries({ queryKey: ['tags'] });
      }

      // Relation events
      if (type === 'relation.created' || type === 'relation.deleted') {
        queryClient.invalidateQueries({ queryKey: ['relations'] });
      }

      // Job events
      if (type.startsWith('job.') || type.startsWith('ai.job.')) {
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
      }

      // Preview ready
      if (type === 'preview.ready' && payload.fileId) {
        queryClient.invalidateQueries({ queryKey: ['file', payload.fileId] });
      }
    }

    // Listen to all event types
    const eventTypes = [
      'file.created', 'file.updated', 'file.deleted', 'file.moved', 'file.indexed',
      'folder.created', 'folder.updated', 'folder.deleted',
      'metadata.updated', 'tag.added', 'tag.removed',
      'relation.created', 'relation.deleted',
      'job.started', 'job.progress', 'job.completed', 'job.failed',
      'preview.ready',
      'ai.job.started', 'ai.job.completed', 'ai.job.failed',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, handleEvent);
    }

    // Also handle generic message events
    es.onmessage = handleEvent;

    es.onerror = () => {
      // EventSource auto-reconnects; show reconnecting state
      setStatus('reconnecting');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [queryClient]);

  return status;
}
