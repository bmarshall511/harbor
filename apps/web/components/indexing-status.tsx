'use client';

/**
 * Indexing status indicator — shows a compact progress bar in the
 * app header when any background job (indexing, preview generation,
 * face detection, Dropbox sync) is running. Auto-hides when idle.
 *
 * Polls /api/jobs every 3 seconds when a job is active.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const JOB_LABELS: Record<string, string> = {
  index: 'Indexing',
  preview: 'Generating previews',
  face_detect: 'Detecting faces',
  sync: 'Syncing Dropbox',
};

export function IndexingStatus() {
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs-status'],
    queryFn: async () => {
      const res = await fetch('/api/jobs');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: (query) => {
      // Poll every 3s when there's an active job, otherwise every 30s
      const activeJobs = query.state.data?.filter(
        (j) => j.status === 'RUNNING' || j.status === 'QUEUED',
      );
      return activeJobs && activeJobs.length > 0 ? 3000 : 30000;
    },
  });

  const activeJobs = (jobs ?? []).filter(
    (j) => j.status === 'RUNNING' || j.status === 'QUEUED',
  );

  if (activeJobs.length === 0) return null;

  const primaryJob = activeJobs[0];
  const label = JOB_LABELS[primaryJob.type] ?? primaryJob.type;
  const progress = primaryJob.progress;
  const hasProgress = progress !== null && progress > 0;

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {hasProgress && (
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}
      {activeJobs.length > 1 && (
        <span className="text-[10px] text-muted-foreground">
          +{activeJobs.length - 1} more
        </span>
      )}
    </div>
  );
}
