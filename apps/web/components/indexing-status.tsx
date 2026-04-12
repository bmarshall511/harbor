'use client';

/**
 * Indexing status indicator — shows real-time progress in the app
 * header when indexing or other background jobs are running.
 *
 * Shows: job type, files/folders processed count, current file path,
 * elapsed time, and a stop button. Completion notifications auto-
 * refresh the file listing and dismiss after 8 seconds.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, File, Folder } from 'lucide-react';
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

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-status'] });
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

  // Completed notification
  if (!activeJobs.length && recentlyCompleted) {
    return <CompletedBadge job={recentlyCompleted} onDismiss={() => setRecentlyCompleted(null)} />;
  }

  if (activeJobs.length === 0) return null;

  const job = activeJobs[0];
  const remaining = activeJobs.length - 1;

  return (
    <ActiveJobCard
      job={job}
      extraCount={remaining}
      onStop={() => cancelMutation.mutate(job.id)}
      stopping={cancelMutation.isPending}
    />
  );
}

// ─── Active job card ────────────────────────────────────────────────────────

function ActiveJobCard({
  job,
  extraCount,
  onStop,
  stopping,
}: {
  job: Job;
  extraCount: number;
  onStop: () => void;
  stopping: boolean;
}) {
  const label = JOB_LABELS[job.type] ?? job.type;
  const meta = job.metadata;
  const filesCount = meta?.filesProcessed ?? 0;
  const foldersCount = meta?.foldersProcessed ?? 0;
  const currentPath = meta?.currentPath ?? '';
  const currentFileName = currentPath ? currentPath.split('/').pop() : '';

  const elapsed = useElapsed(job.startedAt ?? job.createdAt);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      {/* Spinner */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{elapsed}</span>
          {extraCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              +{extraCount} more
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          <span className="flex items-center gap-1">
            <File className="h-3 w-3 opacity-50" />
            {filesCount.toLocaleString()} files
          </span>
          <span className="flex items-center gap-1">
            <Folder className="h-3 w-3 opacity-50" />
            {foldersCount.toLocaleString()} folders
          </span>
        </div>

        {currentFileName && (
          <span className="max-w-[280px] truncate text-[10px] text-muted-foreground/70">
            {currentFileName}
          </span>
        )}
      </div>

      {/* Stop button */}
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className={cn(
          'ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition',
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label="Stop indexing"
        title="Stop indexing"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    </div>
  );
}

// ─── Completed badge ────────────────────────────────────────────────────────

function CompletedBadge({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const label = JOB_LABELS[job.type] ?? job.type;
  const failed = job.status === 'FAILED';
  const meta = job.metadata;
  const cancelled = failed && job.error === 'Cancelled by user';

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-lg border px-3 py-1.5',
      failed ? 'border-destructive/30 bg-destructive/5' : 'border-green-500/30 bg-green-500/5',
    )}>
      {failed
        ? <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
        : <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
      }
      <div className="flex flex-col min-w-0">
        <span className={cn('text-[11px] font-medium', failed ? 'text-destructive' : 'text-green-700 dark:text-green-400')}>
          {label} {cancelled ? 'stopped' : failed ? 'failed' : 'complete'}
        </span>
        {!failed && meta && (
          <span className="text-[10px] text-green-600/70 dark:text-green-400/70">
            {meta.totalFiles ?? meta.filesProcessed ?? 0} files, {meta.totalFolders ?? meta.foldersProcessed ?? 0} folders
          </span>
        )}
        {failed && !cancelled && job.error && (
          <span className="max-w-[220px] truncate text-[10px] text-destructive/70">{job.error}</span>
        )}
        {cancelled && meta && (
          <span className="text-[10px] text-destructive/60">
            Stopped at {meta.filesProcessed ?? 0} files
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Elapsed time hook ──────────────────────────────────────────────────────

function useElapsed(since: string): string {
  const startRef = useRef(new Date(since).getTime());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    startRef.current = new Date(since).getTime();
  }, [since]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sec = Math.max(0, Math.floor((now - startRef.current) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
