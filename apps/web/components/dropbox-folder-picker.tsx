'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { Folder, ChevronRight, ChevronLeft, Cloud, Loader2, Check, Users, User } from 'lucide-react';

interface AccountInfo {
  accountType: string | null;
  rootInfoTag: string | null;
  displayName: string | null;
  hasTeamSpace: boolean;
}

interface BrowseResponse {
  folders: Array<{ name: string; path: string }>;
  currentPath: string;
  accountInfo?: AccountInfo;
}

/**
 * Dropbox folder picker — lets users browse and select a Dropbox folder.
 * Shows account context (personal vs team/business) and root namespace info.
 */
export function DropboxFolderPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (path: string, name: string) => void;
  onCancel: () => void;
}) {
  const [currentPath, setCurrentPath] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dropbox-browse', currentPath],
    queryFn: async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('/api/auth/dropbox/browse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentPath }),
        });
        if (!(res.headers.get('content-type') ?? '').includes('json')) {
          if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
          throw new Error('Server starting up — try again');
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || 'Browse failed');
        return body as BrowseResponse;
      }
      throw new Error('Failed to load');
    },
    retry: 1,
  });

  const navigateInto = (folderPath: string) => {
    setHistory((h) => [...h, currentPath]);
    setCurrentPath(folderPath);
  };

  const navigateBack = () => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentPath(prev ?? '');
  };

  // Normalize to Dropbox-relative format: always starts with /
  const dropboxPath = currentPath ? (currentPath.startsWith('/') ? currentPath : '/' + currentPath) : '/';
  const displayPath = dropboxPath;
  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const currentName = pathParts[pathParts.length - 1] || 'Entire Dropbox';

  const accountInfo = data?.accountInfo;
  const isTeam = accountInfo?.hasTeamSpace === true;
  const accountLabel = accountInfo?.displayName
    ? `${accountInfo.displayName}'s Dropbox`
    : isTeam ? 'Team Dropbox' : 'Dropbox';

  return (
    <div className="rounded-lg border border-border bg-popover">
      {/* Account context banner */}
      {accountInfo && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          {isTeam ? (
            <Users className="h-3.5 w-3.5 text-blue-500" />
          ) : (
            <User className="h-3.5 w-3.5 text-blue-500" />
          )}
          <span className="text-[11px] text-muted-foreground">
            Browsing: <span className="font-medium text-foreground">{accountLabel}</span>
            {isTeam && (
              <span className="ml-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                Team Space
              </span>
            )}
            {accountInfo.accountType === 'business' && !isTeam && (
              <span className="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Business
              </span>
            )}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={navigateBack}
          disabled={history.length === 0}
          className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
          aria-label="Go back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <Cloud className="h-4 w-4 text-blue-500" />
        <span className="flex-1 truncate text-sm font-medium">{displayPath}</span>
      </div>

      {/* Folder list */}
      <div className="max-h-52 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-xs text-destructive">
            {(error as Error).message}
          </div>
        ) : data?.folders.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No subfolders here
          </div>
        ) : (
          data?.folders.map((folder) => (
            <div key={folder.path} className="flex items-center border-b border-border/50 last:border-0">
              <button
                onClick={() => navigateInto(folder.path)}
                className="flex flex-1 items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent"
                title={`Browse into ${folder.name}`}
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-left font-medium">{folder.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => onSelect(folder.path.startsWith('/') ? folder.path : '/' + folder.path, folder.name)}
                className="mr-2 flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                title={`Select ${folder.name}`}
              >
                <Check className="h-3 w-3" />
                Select
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer: select current folder or cancel */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2.5">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={() => onSelect(displayPath, currentName)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Use "{currentName}"
        </button>
      </div>
    </div>
  );
}
