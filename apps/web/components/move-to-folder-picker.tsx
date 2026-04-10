'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { folders as foldersApi, archiveRoots as rootsApi } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { Folder, ChevronRight, ChevronLeft, HardDrive, Loader2, Check } from 'lucide-react';

interface MoveToFolderPickerProps {
  onSelect: (folderId: string, folderName: string) => void;
  onCancel: () => void;
}

/**
 * Folder picker for selecting a destination folder within the current archive.
 * Navigates the archive's folder tree, starting from the root.
 */
export function MoveToFolderPicker({ onSelect, onCancel }: MoveToFolderPickerProps) {
  const activeArchiveRootId = useAppStore((s) => s.activeArchiveRootId);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string | null; name: string }>>([]);

  // Fetch current level folders
  const { data: subfolders, isLoading } = useQuery({
    queryKey: currentFolderId
      ? ['folders', 'children', currentFolderId]
      : ['folders', 'root', activeArchiveRootId],
    queryFn: () =>
      currentFolderId
        ? foldersApi.listChildren(currentFolderId)
        : activeArchiveRootId
          ? foldersApi.listRoot(activeArchiveRootId)
          : Promise.resolve([]),
    enabled: !!activeArchiveRootId,
  });

  // Get archive root name for breadcrumb
  const { data: roots } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: rootsApi.list,
  });
  const currentRoot = roots?.find((r) => r.id === activeArchiveRootId);
  const currentName = history.length > 0
    ? history[history.length - 1]?.name ?? 'Root'
    : currentRoot?.name ?? 'Archive Root';

  const navigateInto = (folderId: string, folderName: string) => {
    setHistory((h) => [...h, { id: currentFolderId, name: currentName }]);
    setCurrentFolderId(folderId);
  };

  const navigateBack = () => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentFolderId(prev?.id ?? null);
  };

  if (!activeArchiveRootId) {
    return (
      <div className="rounded-lg border border-border bg-popover p-4 text-center text-sm text-muted-foreground">
        No archive selected
      </div>
    );
  }

  const displayName = currentFolderId
    ? (subfolders as any)?.[0]?.parentId ? currentName : currentName
    : currentRoot?.name ?? 'Root';

  return (
    <div className="rounded-lg border border-border bg-popover shadow-lg">
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
        <HardDrive className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">{displayName}</span>
      </div>

      {/* Folder list */}
      <div className="max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !subfolders?.length ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No subfolders here
          </div>
        ) : (
          subfolders.map((folder) => (
            <div key={folder.id} className="flex items-center border-b border-border/50 last:border-0">
              <button
                onClick={() => navigateInto(folder.id, folder.name)}
                className="flex flex-1 items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                title={`Browse into ${folder.name}`}
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-left font-medium">{folder.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => onSelect(folder.id, folder.name)}
                className="mr-2 flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                title={`Move here`}
              >
                <Check className="h-3 w-3" />
                Here
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        {currentFolderId && (
          <button
            onClick={() => onSelect(currentFolderId, displayName)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Move to "{displayName}"
          </button>
        )}
      </div>
    </div>
  );
}
