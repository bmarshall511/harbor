'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { Folder, ChevronLeft, HardDrive, Loader2, Check } from 'lucide-react';

/**
 * Local folder picker — browser for the server's filesystem.
 * Starts from the user's home directory and lets them navigate to select a folder.
 */
export function LocalFolderPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (path: string, name: string) => void;
  onCancel: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(''); // empty = home dir

  const { data, isLoading, error } = useQuery({
    queryKey: ['browse-local', currentPath],
    queryFn: async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('/api/browse-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentPath || undefined }),
        });
        if (!(res.headers.get('content-type') ?? '').includes('json')) {
          if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
          throw new Error('Server starting up — try again');
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || 'Browse failed');
        return body as { folders: Array<{ name: string; path: string }>; currentPath: string; parentPath: string | null };
      }
      throw new Error('Failed to load');
    },
    retry: 1,
  });

  const displayPath = data?.currentPath || currentPath || '~';
  const currentName = displayPath.split('/').filter(Boolean).pop() || 'Home';

  return (
    <div className="rounded-lg border border-border bg-popover">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => data?.parentPath && setCurrentPath(data.parentPath)}
          disabled={!data?.parentPath}
          className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
          aria-label="Go up"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <HardDrive className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-mono">{displayPath}</span>
      </div>

      {/* Folder list */}
      <div className="max-h-52 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-xs text-destructive">{(error as Error).message}</div>
        ) : data?.folders.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No subfolders</div>
        ) : (
          data?.folders.map((folder) => (
            <div key={folder.path} className="flex items-center border-b border-border/50 last:border-0">
              <button
                onClick={() => setCurrentPath(folder.path)}
                className="flex flex-1 items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                title={`Browse ${folder.name}`}
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-left">{folder.name}</span>
              </button>
              <button
                onClick={() => onSelect(folder.path, folder.name)}
                className="mr-2 flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
              >
                <Check className="h-3 w-3" />
                Select
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2.5">
        <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
          Cancel
        </button>
        <button
          onClick={() => onSelect(data?.currentPath || currentPath, currentName)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Use "{currentName}"
        </button>
      </div>
    </div>
  );
}
