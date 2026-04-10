'use client';

import { useState, type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { files as filesApi, folders as foldersApi, favorites as favoritesApi, collections as collectionsApi } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/fetch-api';
import { cn } from '@/lib/cn';
import {
  Eye, Pencil, Trash2, FolderInput, Copy, ClipboardCopy,
  FolderPlus, Tag, RefreshCw, Heart, LayoutList, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { RenameDialog, DeleteConfirmDialog, CreateFolderDialog } from '@/components/file-operations';
import type { FileDto, FolderDto } from '@harbor/types';

// ─── Shared styling ────────────────────────────────────────────

const menuContent = 'z-50 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-lg animate-fade-in';
const menuItem = 'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
const menuSeparator = 'my-1 h-px bg-border';
const menuLabel = 'px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

// ─── File Context Menu ─────────────────────────────────────────

export function FileContextMenu({ file, children }: { file: FileDto; children: ReactNode }) {
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const queryClient = useQueryClient();
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const { data: allFavorites } = useQuery({ queryKey: ['favorites'], queryFn: favoritesApi.list });
  const { data: allCollections } = useQuery({ queryKey: ['collections'], queryFn: collectionsApi.list });
  const isFavorited = allFavorites?.some((f) => f.entityType === 'FILE' && f.entityId === file.id) ?? false;

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContent}>
            <ContextMenu.Label className={menuLabel}>File</ContextMenu.Label>

            <ContextMenu.Item className={menuItem} onSelect={() => openDetailPanel('file', file.id)}>
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              Open Details
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={async () => {
              await favoritesApi.toggle('FILE', file.id);
              queryClient.invalidateQueries({ queryKey: ['favorites'] });
              toast.success(isFavorited ? 'Removed from favorites' : 'Added to favorites');
            }}>
              <Heart className={cn('h-3.5 w-3.5', isFavorited ? 'text-red-400 fill-red-400' : 'text-muted-foreground')} />
              {isFavorited ? 'Unfavorite' : 'Favorite'}
            </ContextMenu.Item>

            {allCollections && allCollections.length > 0 && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={menuItem}>
                  <LayoutList className="h-3.5 w-3.5 text-muted-foreground" />
                  Add to Collection
                  <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={menuContent}>
                    {allCollections.map((col) => (
                      <ContextMenu.Item key={col.id} className={menuItem} onSelect={async () => {
                        await collectionsApi.addItem(col.id, 'FILE', file.id);
                        queryClient.invalidateQueries({ queryKey: ['collections'] });
                        toast.success(`Added to "${col.name}"`);
                      }}>
                        <LayoutList className="h-3.5 w-3.5 text-muted-foreground" />
                        {col.name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}

            <ContextMenu.Separator className={menuSeparator} />

            <ContextMenu.Item className={menuItem} onSelect={() => setShowRename(true)}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Rename
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={() => setShowDelete(true)}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              Delete
            </ContextMenu.Item>

            <ContextMenu.Separator className={menuSeparator} />

            <ContextMenu.Item className={menuItem} onSelect={() => {
              navigator.clipboard.writeText(file.id);
              toast.success('File ID copied');
            }}>
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy ID
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={() => {
              navigator.clipboard.writeText(file.path);
              toast.success('Path copied');
            }}>
              <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy Path
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {showRename && (
        <RenameDialog entityType="file" entityId={file.id} currentName={file.name} onClose={() => setShowRename(false)} />
      )}
      {showDelete && (
        <DeleteConfirmDialog entityType="file" entityId={file.id} entityName={file.name} onClose={() => setShowDelete(false)} />
      )}
    </>
  );
}

// ─── Folder Context Menu ───────────────────────────────────────

export function FolderContextMenu({ folder, children }: { folder: FolderDto; children: ReactNode }) {
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const [showDelete, setShowDelete] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContent}>
            <ContextMenu.Label className={menuLabel}>Folder</ContextMenu.Label>

            <ContextMenu.Item className={menuItem} onSelect={() => setActiveFolderId(folder.id)}>
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              Open
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={() => openDetailPanel('folder', folder.id)}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Edit Details
            </ContextMenu.Item>

            <ContextMenu.Separator className={menuSeparator} />

            <ContextMenu.Item className={menuItem} onSelect={() => setShowCreateSub(true)}>
              <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
              New Subfolder
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={() => setShowDelete(true)}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              Delete
            </ContextMenu.Item>

            <ContextMenu.Separator className={menuSeparator} />

            <ContextMenu.Item className={menuItem} onSelect={() => {
              navigator.clipboard.writeText(folder.id);
              toast.success('Folder ID copied');
            }}>
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy ID
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItem} onSelect={() => {
              navigator.clipboard.writeText(folder.path);
              toast.success('Path copied');
            }}>
              <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy Path
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {showDelete && (
        <DeleteConfirmDialog entityType="folder" entityId={folder.id} entityName={folder.name} onClose={() => setShowDelete(false)} />
      )}
      {showCreateSub && (
        <CreateFolderDialog archiveRootId={folder.archiveRootId} parentId={folder.id} onClose={() => setShowCreateSub(false)} />
      )}
    </>
  );
}

// ─── Archive Root Context Menu ─────────────────────────────────

export function ArchiveRootContextMenu({
  root,
  children,
  onRename,
  onReindex,
  onRemove,
}: {
  root: { id: string; name: string; rootPath: string; providerType: string };
  children: ReactNode;
  onRename?: () => void;
  onReindex?: () => void;
  onRemove?: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent}>
          <ContextMenu.Label className={menuLabel}>
            {root.providerType === 'DROPBOX' ? 'Dropbox Archive' : 'Local Archive'}
          </ContextMenu.Label>

          {onRename && (
            <ContextMenu.Item className={menuItem} onSelect={onRename}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Rename
            </ContextMenu.Item>
          )}

          {onReindex && (
            <ContextMenu.Item className={menuItem} onSelect={onReindex}>
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              Re-index
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className={menuSeparator} />

          <ContextMenu.Item className={menuItem} onSelect={() => {
            navigator.clipboard.writeText(root.rootPath);
            toast.success('Root path copied');
          }}>
            <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
            Copy Path
          </ContextMenu.Item>

          <ContextMenu.Item className={menuItem} onSelect={() => {
            navigator.clipboard.writeText(root.id);
            toast.success('Root ID copied');
          }}>
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            Copy ID
          </ContextMenu.Item>

          {onRemove && (
            <>
              <ContextMenu.Separator className={menuSeparator} />
              <ContextMenu.Item className={cn(menuItem, 'text-destructive data-[highlighted]:text-destructive')} onSelect={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
                Remove from Harbor
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
