'use client';

import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { archiveRoots, folders as foldersApi } from '@/lib/api';
import { ChevronRight, Home } from 'lucide-react';
import { friendlyName } from '@harbor/utils';

export function Breadcrumbs({
  archiveRootId,
  folderId,
}: {
  archiveRootId: string;
  folderId: string | null;
}) {
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);

  const { data: root } = useQuery({
    queryKey: ['archive-root', archiveRootId],
    queryFn: () => archiveRoots.get(archiveRootId),
  });

  const { data: folder } = useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => foldersApi.get(folderId!),
    enabled: !!folderId,
  });

  const { data: tree } = useQuery({
    queryKey: ['folders', 'tree', archiveRootId],
    queryFn: () => foldersApi.tree(archiveRootId),
    enabled: !!folderId,
  });

  // Build the ancestor chain by walking up parentId refs in the tree
  const ancestors: Array<{ name: string; id: string }> = [];
  if (folder && tree) {
    const treeById = new Map(tree.map((f: any) => [f.id, f]));
    let current = treeById.get(folder.parentId);
    while (current) {
      ancestors.unshift({ name: current.name, id: current.id });
      current = treeById.get(current.parentId);
    }
  }

  return (
    <nav className="flex items-center gap-1 overflow-x-auto px-4 py-2 text-sm" aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 whitespace-nowrap" role="list">
        <li>
          <button
            onClick={() => setActiveFolderId(null)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{root?.name ?? 'Archive'}</span>
          </button>
        </li>

        {ancestors.map((anc) => (
          <li key={anc.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button
              onClick={() => setActiveFolderId(anc.id)}
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {friendlyName(anc.name, true)}
            </button>
          </li>
        ))}

        {folder && (
          <li className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="rounded px-1.5 py-0.5 font-medium" aria-current="page">
              {friendlyName(folder.name, true)}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
