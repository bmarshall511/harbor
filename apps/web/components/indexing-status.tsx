'use client';

/**
 * Indexing status indicator — shows real-time progress in the app
 * header when indexing or other background jobs are running.
 *
 * Shows: job type, files/folders processed count, current file path,
 * and a completion notification that auto-refreshes the file listing.
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, File, Folder } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number | null;
  error: string | null;
  metadata: {
    filesProcessed?: number;
    foldersProcessed?: number;
    currentPath?: string;
    totalFiles?: number;
    totalFolders?: number;
    archiveRootId?: string;
    [key: string]: unknown;
  } | null;
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

  // Track completion for auto-refresh
  useEffect(() => {
    if (!jobs) return;
    const justCompleted = jobs.find(
      (j) => (j.status === 'COMPLETED' || j.status === 'FAILED') && j.completedAt &&
        Date.now() - new Date(j.completedAt).getTime() < 10_000,
    );
    if (justCompleted && justCompleted.id !== recentlyCompleted?.id) {
      setRecentlyCompleted(justCompleted);
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      const timer = setTimeout(() => setRecentlyCompleted(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [jobs, recentlyCompleted, queryClient]);

  // Show completed notification
  if (!activeJobs.length && recentlyCompleted) {
    const label = JOB_LABELS[recentlyCompleted.type] ?? recentlyCompleted.type;
    const failed = recentlyCompleted.status === 'FAILED';
    const meta = recentlyCompleted.metadata;
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5',
        failed ? 'border-destructive/40 bg-destructive/10' : 'border-green-500/40 bg-green-500/10',
      )}>
        {failed ? <X className="h-3.5 w-3.5 text-destructive" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
        <div className="flex flex-col">
          <span className={cn('text-[11px] font-medium', failed ? 'text-destructive' : 'text-green-700 dark:text-green-400')}>
            {label} {failed ? 'failed' : 'complete'}
          </span>
          {!failed && meta && (
            <span className="text-[10px] text-green-600/70 dark:text-green-400/70">
              {meta.totalFiles ?? meta.filesProcessed ?? 0} files, {meta.totalFolders ?? meta.foldersProcessed ?? 0} folders
            </span>
          )}
          {failed && recentlyCompleted.error && (
            <span className="max-w-[200px] truncate text-[10px] text-destructive/70">{recentlyCompleted.error}</span>
          )}
        </div>
      </div>
    );
  }

  if (activeJobs.length === 0) return null;

  const job = activeJobs[0];
  const label = JOB_LABELS[job.type] ?? job.type;
  const meta = job.metadata;
  const filesCount = meta?.filesProcessed ?? 0;
  const foldersCount = meta?.foldersProcessed ?? 0;
  const currentPath = meta?.currentPath ?? '';
  const currentFileName = currentPath ? currentPath.split('/').pop() : '';

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-foreground">{label}</span>
          <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <File className="h-2.5 w-2.5" />{filesCount.toLocaleString()}
            </span>
            <span className="flex items-center gap-0.5">
              <Folder className="h-2.5 w-2.5" />{foldersCount.toLocaleString()}
            </span>
          </div>
        </div>
        {currentFileName && (
          <span className="max-w-[250px] truncate text-[10px] text-muted-foreground">
            {currentFileName}
          </span>
        )}
      </div>
      {activeJobs.length > 1 && (
        <span className="text-[10px] text-muted-foreground">+{activeJobs.length - 1}</span>
      )}
    </div>
  );
}
