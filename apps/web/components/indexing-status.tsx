'use client';

/**
 * Indexing status indicator — shows a progress bar in the app header
 * when any background job is running. Polls /api/jobs every 2 seconds
 * when active. Auto-hides when idle. Shows recently completed jobs
 * briefly before hiding.
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
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
  index: 'Indexing archive',
  preview: 'Generating previews',
  face_detect: 'Detecting faces',
  sync: 'Syncing Dropbox',
};

export function IndexingStatus() {
  const queryClient = useQueryClient();
  const [recentlyCompleted, setRecentlyCompleted] = useState<Job | null>(null);

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs-status'],
    queryFn: async () => {
      const res = await fetch('/api/jobs');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: (query) => {
      const active = query.state.data?.filter(
        (j) => j.status === 'RUNNING' || j.status === 'QUEUED',
      );
      return active && active.length > 0 ? 2000 : 30000;
    },
  });

  const activeJobs = (jobs ?? []).filter(
    (j) => j.status === 'RUNNING' || j.status === 'QUEUED',
  );

  // Track when a job completes so we can show a brief "Done" message
  useEffect(() => {
    if (!jobs) return;
    const justCompleted = jobs.find(
      (j) => j.status === 'COMPLETED' && j.completedAt &&
        Date.now() - new Date(j.completedAt).getTime() < 10_000,
    );
    if (justCompleted && justCompleted.id !== recentlyCompleted?.id) {
      setRecentlyCompleted(justCompleted);
      // Invalidate file/folder queries so the UI refreshes
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      // Auto-hide after 5 seconds
      const timer = setTimeout(() => setRecentlyCompleted(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [jobs, recentlyCompleted, queryClient]);

  // Show recently completed job
  if (!activeJobs.length && recentlyCompleted) {
    const label = JOB_LABELS[recentlyCompleted.type] ?? recentlyCompleted.type;
    const failed = recentlyCompleted.status === 'FAILED';
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1',
        failed ? 'border-destructive/40 bg-destructive/10' : 'border-green-500/40 bg-green-500/10',
      )}>
        {failed ? (
          <X className="h-3 w-3 text-destructive" />
        ) : (
          <Check className="h-3 w-3 text-green-600" />
        )}
        <span className={cn('text-[11px] font-medium', failed ? 'text-destructive' : 'text-green-700 dark:text-green-400')}>
          {label} — {failed ? 'failed' : 'complete'}
        </span>
      </div>
    );
  }

  if (activeJobs.length === 0) return null;

  const primaryJob = activeJobs[0];
  const label = JOB_LABELS[primaryJob.type] ?? primaryJob.type;
  const progress = primaryJob.progress;
  const hasProgress = progress !== null && progress > 0;
  const pct = hasProgress ? Math.round(progress * 100) : 0;

  return (
    <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {hasProgress ? (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-primary/20">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-primary/80">{pct}%</span>
        </div>
      ) : (
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-primary/20">
          <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      )}
      {activeJobs.length > 1 && (
        <span className="text-[10px] text-muted-foreground">+{activeJobs.length - 1} more</span>
      )}
    </div>
  );
}
