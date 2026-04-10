'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveRoots } from '@/lib/api';
import { fetchApi } from '@/lib/fetch-api';
import { useAppStore } from '@/lib/store';
import { useIsElectron } from '@/lib/use-mounted';
import { cn } from '@/lib/cn';
import { Archive, HardDrive, Cloud, BookOpen, Plus, ArrowRight, Check, FolderOpen, FolderSearch } from 'lucide-react';
import { toast } from 'sonner';

export function WelcomeScreen() {
  const { data: roots, isLoading } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: archiveRoots.list,
  });

  const hasRoots = (roots?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return hasRoots ? <QuickStartScreen roots={roots!} /> : <FirstRunScreen />;
}

function FirstRunScreen() {
  const [step, setStep] = useState<'intro' | 'add-root'>('intro');

  if (step === 'add-root') {
    return <AddRootStep onBack={() => setStep('intro')} />;
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="rounded-full bg-primary/10 p-5">
        <Archive className="h-12 w-12 text-primary" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Welcome to Harbor</h1>
      <p className="mt-2 max-w-md text-center text-muted-foreground">
        Get started by connecting your first archive. Harbor will index your files and make them
        searchable, taggable, and beautifully browsable.
      </p>

      <div className="mt-8 grid w-full max-w-lg gap-3 sm:grid-cols-2">
        <button
          onClick={() => setStep('add-root')}
          className={cn(
            'flex items-center gap-4 rounded-xl border-2 border-dashed border-border p-5 text-left transition-all',
            'hover:border-primary/40 hover:bg-accent/50',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <div className="rounded-lg bg-primary/10 p-2.5">
            <HardDrive className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Local Folder</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Browse a directory on this computer
            </p>
          </div>
        </button>

        <div
          className={cn(
            'flex items-center gap-4 rounded-xl border-2 border-dashed border-border p-5 text-left opacity-60',
          )}
        >
          <div className="rounded-lg bg-muted p-2.5">
            <Cloud className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Dropbox</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Connect via OAuth (configure keys first)
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 grid max-w-lg grid-cols-3 gap-4">
        <FeatureHint icon={BookOpen} text="Rich metadata and tagging" />
        <FeatureHint icon={Archive} text="AI-powered enrichment" />
        <FeatureHint icon={FolderOpen} text="Link related files" />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Press{' '}
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">?</kbd>
        {' '}anytime for keyboard shortcuts
      </p>
    </div>
  );
}

function AddRootStep({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);
  const isElectron = useIsElectron();
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [indexing, setIndexing] = useState(false);

  const [pathError, setPathError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Validate path first (with retry for cold-compile)
      const validation = await fetchApi<{ valid: boolean; error?: string }>('/validate-path', {
        method: 'POST',
        body: JSON.stringify({ path: rootPath }),
        retries: 2,
      });
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid directory path');
      }

      return fetchApi<{ id: string }>('/archive-roots', {
        method: 'POST',
        body: JSON.stringify({
          name,
          providerType: 'LOCAL_FILESYSTEM',
          rootPath,
          capabilities: ['READ', 'WRITE', 'DELETE', 'MOVE', 'RENAME', 'CREATE_FOLDERS', 'SEARCH'],
        }),
      });
    },
    onSuccess: async (root) => {
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      setActiveArchiveRootId(root.id);

      // Trigger indexing
      setIndexing(true);
      try {
        await fetchApi('/indexing', {
          method: 'POST',
          body: JSON.stringify({ archiveRootId: root.id }),
          retries: 2,
        });
        toast.success('Archive root added and indexing started');
      } catch {
        toast.success('Archive root added');
      }
      setIndexing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <button
          onClick={onBack}
          className="mb-6 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back
        </button>

        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <HardDrive className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Add Local Archive</h2>
            <p className="text-sm text-muted-foreground">
              Point Harbor at a folder to start browsing
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="root-name" className="mb-1.5 block text-sm font-medium">
              Archive Name
            </label>
            <input
              id="root-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Photos, Documents, Media"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="root-path" className="mb-1.5 block text-sm font-medium">
              Folder
            </label>
            {isElectron ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    const dir = await (window as any).harbor.selectDirectory();
                    if (dir) {
                      setRootPath(dir);
                      if (!name) setName(dir.split('/').filter(Boolean).pop() || '');
                    }
                  }}
                  className={cn(
                    'flex w-full items-center justify-center gap-3 rounded-lg border-2 py-6 text-sm font-medium transition-colors',
                    rootPath
                      ? 'border-primary/30 bg-primary/5 text-foreground'
                      : 'border-dashed border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/50',
                  )}
                >
                  <FolderSearch className="h-6 w-6" />
                  <span>{rootPath || 'Choose Folder...'}</span>
                </button>
                {rootPath && (
                  <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                    <FolderSearch className="h-4 w-4 text-primary" />
                    <span className="truncate text-sm">{rootPath}</span>
                    <button onClick={() => setRootPath('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Change</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  id="root-path"
                  type="text"
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  placeholder="/Users/you/Photos"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">Full absolute path to the folder</p>
              </div>
            )}
          </div>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || !rootPath.trim() || createMutation.isPending || indexing}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {createMutation.isPending || indexing ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                {indexing ? 'Indexing...' : 'Creating...'}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Archive and Start Indexing
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickStartScreen({ roots }: { roots: Array<{ id: string; name: string; providerType: string }> }) {
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="rounded-full bg-primary/10 p-4">
        <Archive className="h-10 w-10 text-primary" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-bold tracking-tight">Select an Archive</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Choose an archive root to start browsing
      </p>

      <div className="mt-6 w-full max-w-sm space-y-2">
        {roots.map((root) => (
          <button
            key={root.id}
            onClick={() => setActiveArchiveRootId(root.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3.5 text-left transition-all',
              'hover:border-primary/30 hover:bg-accent hover:shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {root.providerType === 'DROPBOX' ? (
              <Cloud className="h-5 w-5 text-muted-foreground" />
            ) : (
              <HardDrive className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="flex-1 text-sm font-medium">{root.name}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Or go to{' '}
        <a href="/settings" className="font-medium text-primary hover:underline">Settings</a>
        {' '}to add more archives
      </p>
    </div>
  );
}

function FeatureHint({ icon: Icon, text }: { icon: typeof Archive; text: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Icon className="h-5 w-5 text-muted-foreground/60" />
      <p className="mt-1.5 text-[11px] text-muted-foreground">{text}</p>
    </div>
  );
}
