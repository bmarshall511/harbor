'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FolderDto } from '@harbor/types';
import { useAppStore } from '@/lib/store';
import { files as filesApi, folders as foldersApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FolderContextMenu } from '@/components/context-menus';
import { Folder, Calendar, MapPin, FolderOpen, FileText, ChevronRight } from 'lucide-react';
import { friendlyName } from '@harbor/utils';
import { toast } from 'sonner';

export function FolderCards({ folders }: { folders: FolderDto[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {folders.map((folder, i) => (
        <div key={folder.id} className="animate-content-show" style={{ animationDelay: `${Math.min(i * 25, 150)}ms`, animationFillMode: 'both' }}>
          <FolderCard folder={folder} />
        </div>
      ))}
    </div>
  );
}

function FolderCard({ folder }: { folder: FolderDto }) {
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [dragInvalid, setDragInvalid] = useState(false);

  const fileMoveMutation = useMutation({
    mutationFn: (fileId: string) => filesApi.move(fileId, folder.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success(`File moved to ${folder.name}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const folderMoveMutation = useMutation({
    mutationFn: (folderId: string) => foldersApi.move(folderId, folder.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success(`Folder moved to ${folder.name}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('application/harbor-file-id') || e.dataTransfer.types.includes('application/harbor-folder-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
      setDragInvalid(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    setDragInvalid(false);
    const fileId = e.dataTransfer.getData('application/harbor-file-id');
    if (fileId) { fileMoveMutation.mutate(fileId); return; }
    const draggedFolderId = e.dataTransfer.getData('application/harbor-folder-id');
    if (draggedFolderId) {
      if (draggedFolderId === folder.id) { toast.error('Cannot move a folder into itself'); return; }
      folderMoveMutation.mutate(draggedFolderId);
    }
  }

  const childCount = folder.childCount ?? 0;
  const fileCount = folder.fileCount ?? 0;
  const totalItems = childCount + fileCount;

  return (
    <FolderContextMenu folder={folder}>
    <button
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/harbor-folder-id', folder.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => setActiveFolderId(folder.id)}
      onDoubleClick={() => openDetailPanel('folder', folder.id)}
      onDragOver={handleDragOver}
      onDragLeave={() => { setDragOver(false); setDragInvalid(false); }}
      onDrop={handleDrop}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left',
        'transition-all duration-150 ease-out',
        'hover:border-primary/30 hover:bg-accent/50 hover:shadow-sm hover:-translate-y-px',
        'active:translate-y-0 active:shadow-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        dragOver && !dragInvalid && 'border-primary bg-primary/5 ring-2 ring-primary/30 scale-[1.01]',
        dragInvalid && 'border-destructive/50 bg-destructive/5 ring-2 ring-destructive/30',
        !dragOver && 'border-border',
      )}
    >
      {/* Icon */}
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
        dragOver ? 'bg-primary/15 text-primary' : 'bg-primary/8 text-primary/70 group-hover:bg-primary/12 group-hover:text-primary',
      )}>
        <Folder className="h-5 w-5" aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold leading-tight" title={folder.name}>{friendlyName(folder.name, true)}</p>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {totalItems > 0 ? (
            <>
              {childCount > 0 && (
                <span className="flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {childCount}
                </span>
              )}
              {fileCount > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {fileCount}
                </span>
              )}
            </>
          ) : (
            <span className="italic">Empty</span>
          )}
          {folder.eventDate && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(folder.eventDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
            </span>
          )}
          {folder.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{folder.location}</span>
            </span>
          )}
        </div>
      </div>

      {/* Arrow indicator */}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
    </button>
    </FolderContextMenu>
  );
}
