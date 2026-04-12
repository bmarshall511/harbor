'use client';

/**
 * Indexing status indicator — compact single-line display in the
 * app header showing progress of background jobs.
 *
 * Design constraints:
 *   - Must fit within the 48px header bar (h-12)
 *   - Single line: [spinner] Label  count  elapsed  [stop]
 *   - No multi-line cards or expanded states
 *   - Completion flash: brief inline success/failure message
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, Image, Video, FileText, Folder } from 'lucide-react';
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
  preview: 'Previews',
  face_detect: 'Faces',
  sync: 'Syncing',
};

export function IndexingStatus() {
  const queryClient = useQueryClient();
  const [recentlyCompleted, setRecentlyCompleted] = useState<Job | null>(null);

  // ── Elapsed timer — always runs, reads from activeStartTime ────
  // This avoids calling useElapsed conditionally, which breaks hooks.
  const [activeStartTime, setActiveStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (activeStartTime === null) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - activeStartTime) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeStartTime]);

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
      return active && active.length > 0 ? 5000 : 30000;
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

  // Keep the elapsed timer in sync with the active job
  const activeJob = activeJobs[0] ?? null;
  const activeJobStartRef = useRef<string | null>(null);
  useEffect(() => {
    const startStr = activeJob?.startedAt ?? activeJob?.createdAt ?? null;
    if (startStr !== activeJobStartRef.current) {
      activeJobStartRef.current = startStr;
      setActiveStartTime(startStr ? new Date(startStr).getTime() : null);
    }
  }, [activeJob]);

  // Track completion for auto-refresh
  // (Server-side continuation handles chunked indexing — no client polling needed)
  useEffect(() => {
    if (!jobs) return;
    const justCompleted = jobs.find(
      (j) => (j.status === 'COMPLETED' || j.status === 'FAILED') && j.completedAt &&
        !((j.metadata as any)?.partial) && // Don't show completion for partial jobs
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

  // Format elapsed seconds
  const elapsedStr = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m${(elapsed % 60).toString().padStart(2, '0')}s`;

  // ── Completed notification ─────────────────────────────────────
  if (!activeJobs.length && recentlyCompleted) {
    const label = JOB_LABELS[recentlyCompleted.type] ?? recentlyCompleted.type;
    const failed = recentlyCompleted.status === 'FAILED';
    const cancelled = failed && recentlyCompleted.error === 'Cancelled by user';
    const meta = recentlyCompleted.metadata;

    return (
      <div className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
        failed ? 'text-destructive' : 'text-green-600 dark:text-green-400',
      )}>
        {failed ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
        <span className="font-medium">
          {label} {cancelled ? 'stopped' : failed ? 'failed' : 'done'}
        </span>
        {!failed && meta && (
          <span className="text-muted-foreground">
            — {meta.totalFiles ?? meta.filesProcessed ?? 0} files
          </span>
        )}
        <button
          type="button"
          onClick={() => setRecentlyCompleted(null)}
          className="ml-0.5 rounded p-0.5 hover:bg-accent"
          aria-label="Dismiss"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // ── No active jobs ─────────────────────────────────────────────
  if (!activeJob) return null;

  // ── Active job indicator ───────────────────────────────────────
  const label = JOB_LABELS[activeJob.type] ?? activeJob.type;
  const meta = activeJob.metadata;
  const images = (meta?.images as number) ?? 0;
  const videos = (meta?.videos as number) ?? 0;
  const docs = (meta?.documents as number) ?? 0;
  const folders = (meta?.foldersProcessed as number) ?? 0;
  const totalFiles = (meta?.filesProcessed as number) ?? 0;
  const remaining = activeJobs.length - 1;

  // Build a concise breakdown string
  const parts: string[] = [];
  if (images > 0) parts.push(`${images} img`);
  if (videos > 0) parts.push(`${videos} vid`);
  if (docs > 0) parts.push(`${docs} doc`);
  if (folders > 0) parts.push(`${folders} dir`);
  const otherCount = totalFiles - images - videos - docs;
  if (otherCount > 0) parts.push(`${otherCount} other`);
  const breakdown = parts.length > 0 ? parts.join(' · ') : `${totalFiles} files`;

  return (
    <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
      <span className="font-semibold text-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">{breakdown}</span>
      <span className="tabular-nums text-muted-foreground/60">{elapsedStr}</span>
      {remaining > 0 && (
        <span className="text-muted-foreground/60">+{remaining}</span>
      )}
      <button
        type="button"
        onClick={() => cancelMutation.mutate(activeJob.id)}
        disabled={cancelMutation.isPending}
        className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        aria-label="Stop"
        title="Stop"
      >
        <Square className="h-2.5 w-2.5 fill-current" />
      </button>
    </div>
  );
}
