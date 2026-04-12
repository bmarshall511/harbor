'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { archiveRoots, folders, files as filesApi, favorites as favoritesApi, collections as collectionsApi, review as reviewApi } from '@/lib/api';
import { useAuth } from '@/lib/use-auth';
import { friendlyName } from '@harbor/utils';
import { fetchApi } from '@/lib/fetch-api';
import { cn } from '@/lib/cn';
import { ArchiveRootContextMenu } from '@/components/context-menus';
import { toast } from 'sonner';
import {
  Archive,
  ChevronRight,
  ChevronDown,
  Folder,
  HardDrive,
  Cloud,
  Search,
  Settings,
  Star,
  PanelLeftClose,
  PanelLeft,
  Heart,
  LayoutList,
  Plus,
  LogOut,
  User,
  Trash2,
  Lock,
  Globe,
  LayoutDashboard,
  Network,
  ClipboardCheck,
} from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import type { FolderDto, ArchiveRootDto } from '@harbor/types';

/** Navigate between tree item buttons with arrow keys */
function handleTreeKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
  const btn = e.currentTarget;
  const nav = btn.closest('nav');
  if (!nav) return;

  const allButtons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-tree-item]'));
  const idx = allButtons.indexOf(btn);
  if (idx === -1) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    allButtons[idx + 1]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    allButtons[idx - 1]?.focus();
  } else if (e.key === 'ArrowRight') {
    // Expand or move to first child
    e.preventDefault();
    const li = btn.closest('li');
    if (li?.getAttribute('aria-expanded') === 'false') {
      btn.click(); // expand
    } else {
      allButtons[idx + 1]?.focus(); // go to first child
    }
  } else if (e.key === 'ArrowLeft') {
    // Collapse or move to parent
    e.preventDefault();
    const li = btn.closest('li');
    if (li?.getAttribute('aria-expanded') === 'true') {
      btn.click(); // collapse
    } else {
      // Move to parent tree item
      const parentLi = li?.parentElement?.closest('li[role="treeitem"]');
      const parentBtn = parentLi?.querySelector<HTMLButtonElement>('button[data-tree-item]');
      parentBtn?.focus();
    }
  } else if (e.key === 'Home') {
    e.preventDefault();
    allButtons[0]?.focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    allButtons[allButtons.length - 1]?.focus();
  }
}

export function AppSidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200',
        sidebarOpen ? 'w-64' : 'w-0 overflow-hidden',
      )}
      role="complementary"
      aria-label="Archive navigation"
    >
      <div className="flex h-12 items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Harbor</span>
        </div>
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="Close sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Top-level destinations: Dashboard + Favorites. Both render as
          full-width nav buttons with the same shape/spacing so the
          two feel like siblings rather than the favorites being a
          dropdown attached to the archive list. */}
      <div className="border-b border-sidebar-border p-2 space-y-0.5">
        <DashboardLink />
        <SearchLink />
        <FavoritesLink />
        <ConnectionsLink />
        <ReviewLink />
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Archive roots">
        <ArchiveRootList />
        <CollectionsSection />
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <SidebarFooterLinks />
        <UserSection />
      </div>
    </aside>
  );
}

function ArchiveRootList() {
  const { data: roots, isLoading } = useQuery({
    queryKey: ['archive-roots'],
    queryFn: archiveRoots.list,
  });
  const activeArchiveRootId = useAppStore((s) => s.activeArchiveRootId);
  const setActiveArchiveRootId = useAppStore((s) => s.setActiveArchiveRootId);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-sidebar-accent" />
        ))}
      </div>
    );
  }

  if (!roots?.length) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>No archive roots configured.</p>
        <p className="mt-1 text-xs">Add one in Settings to get started.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-0.5" role="tree">
      {roots.map((root) => (
        <ArchiveRootItem
          key={root.id}
          root={root}
          isActive={root.id === activeArchiveRootId}
          onSelect={() => setActiveArchiveRootId(root.id)}
        />
      ))}
    </ul>
  );
}

function ArchiveRootItem({
  root,
  isActive,
  onSelect,
}: {
  root: ArchiveRootDto;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const Icon = root.providerType === 'DROPBOX' ? Cloud : HardDrive;

  return (
    <li role="treeitem" aria-expanded={expanded}>
      <ArchiveRootContextMenu
        root={root}
        onReindex={() => {
          fetch('/api/indexing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archiveRootId: root.id }),
          }).catch(() => {});
          toast.success(`Re-indexing "${root.name}" started — progress in the header`);
        }}
      >
      <button
        data-tree-item
        onClick={() => {
          onSelect();
          setExpanded(!expanded);
          if (pathname !== '/') router.push('/');
        }}
        onKeyDown={handleTreeKeyDown}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{root.name}</span>
        {root.isPrivate && (
          <span className="ml-auto text-[10px] font-medium uppercase text-muted-foreground">
            Private
          </span>
        )}
      </button>
      </ArchiveRootContextMenu>
      {expanded && isActive && <FolderTree archiveRootId={root.id} />}
    </li>
  );
}

function FolderTree({ archiveRootId }: { archiveRootId: string }) {
  const { data: rootFolders, isLoading } = useQuery({
    queryKey: ['folders', 'root', archiveRootId],
    queryFn: () => folders.listRoot(archiveRootId),
  });

  if (isLoading) {
    return (
      <div className="ml-6 space-y-1 py-1">
        {[1, 2].map((i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-sidebar-accent" />
        ))}
      </div>
    );
  }

  if (!rootFolders?.length) return null;

  return (
    <ul className="ml-3 space-y-0.5 py-0.5" role="group">
      {rootFolders.map((folder) => (
        <FolderTreeItem key={folder.id} folder={folder} depth={1} />
      ))}
    </ul>
  );
}

function FolderTreeItem({ folder, depth }: { folder: FolderDto; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const activeFolderId = useAppStore((s) => s.activeFolderId);
  const setActiveFolderId = useAppStore((s) => s.setActiveFolderId);
  const isActive = activeFolderId === folder.id;
  const hasChildren = (folder.childCount ?? 0) > 0;

  const { data: children } = useQuery({
    queryKey: ['folders', 'children', folder.id],
    queryFn: () => folders.listChildren(folder.id),
    enabled: expanded && hasChildren,
  });

  return (
    <li role="treeitem" aria-expanded={expanded}>
      <button
        data-tree-item
        onClick={() => {
          setActiveFolderId(folder.id);
          if (hasChildren) setExpanded(!expanded);
          if (pathname !== '/') router.push('/');
        }}
        onKeyDown={handleTreeKeyDown}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/harbor-file-id') || e.dataTransfer.types.includes('application/harbor-folder-id')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          const fileId = e.dataTransfer.getData('application/harbor-file-id');
          if (fileId) {
            try {
              await filesApi.move(fileId, folder.id);
              queryClient.invalidateQueries({ queryKey: ['files'] });
              queryClient.invalidateQueries({ queryKey: ['folders'] });
            } catch { /* move error shown by API layer */ }
            return;
          }
          const folderId = e.dataTransfer.getData('application/harbor-folder-id');
          if (folderId && folderId !== folder.id) {
            try {
              await folders.move(folderId, folder.id);
              queryClient.invalidateQueries({ queryKey: ['files'] });
              queryClient.invalidateQueries({ queryKey: ['folders'] });
            } catch { /* move error shown by API layer */ }
          }
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
          dragOver && 'bg-primary/10 ring-1 ring-primary/30',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate" title={folder.name}>{friendlyName(folder.name, true)}</span>
        {(folder.fileCount ?? 0) > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{folder.fileCount}</span>
        )}
      </button>
      {expanded && children && children.length > 0 && (
        <ul className="space-y-0.5" role="group">
          {children.map((child) => (
            <FolderTreeItem key={child.id} folder={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Dashboard nav button. Clicking it both navigates the app to `/`
 * (the dashboard surface for the home page) and clears any active
 * archive root selection so the dashboard actually renders instead
 * of the archive browser snapping back into view.
 */
function DashboardLink() {
  const router = useRouter();
  const pathname = usePathname();
  const activeArchiveRootId = useAppStore((s) => s.activeArchiveRootId);
  const isActive = pathname === '/' && !activeArchiveRootId;

  return (
    <button
      onClick={() => {
        useAppStore.getState().setActiveArchiveRootId(null);
        if (pathname !== '/') router.push('/');
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
      <span>Dashboard</span>
    </button>
  );
}

/**
 * Favorites nav button. Sits directly under Dashboard and uses the
 * same shape, spacing, and active-state styling so the two read as
 * a single set of top-level destinations.
 */
function FavoritesLink() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: favs } = useQuery({
    queryKey: ['favorites'],
    queryFn: favoritesApi.list,
  });
  const isActive = pathname === '/favorites';
  const count = favs?.length ?? 0;

  return (
    <button
      onClick={() => router.push('/favorites')}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Heart
        className={cn('h-4 w-4', isActive && 'fill-current text-red-400')}
        aria-hidden="true"
      />
      <span>Favorites</span>
      {count > 0 && (
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

function ConnectionsLink() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname === '/connections';

  return (
    <button
      onClick={() => router.push('/connections')}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Network
        className={cn('h-4 w-4', isActive && 'text-primary')}
        aria-hidden="true"
      />
      <span>Connections</span>
    </button>
  );
}

function ReviewLink() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname === '/review';
  const { data } = useQuery({
    queryKey: ['review-queue-count'],
    queryFn: async () => {
      try {
        return await reviewApi.queue({ limit: 1 });
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const count = data?.needsReviewCount ?? 0;

  return (
    <button
      onClick={() => router.push('/review')}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <ClipboardCheck
        className={cn('h-4 w-4', isActive && 'text-primary')}
        aria-hidden="true"
      />
      <span>Review</span>
      {count > 0 && (
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

function SearchLink() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname === '/search';

  return (
    <button
      onClick={() => router.push('/search')}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span>Search</span>
    </button>
  );
}

function CollectionsSection() {
  const queryClient = useQueryClient();
  const { data: cols } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrivate, setNewPrivate] = useState(true);

  const createMutation = useMutation({
    mutationFn: () => collectionsApi.create(newName, undefined, undefined, newPrivate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
      setShowCreate(false);
      toast.success('Collection created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => collectionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      toast.success('Collection deleted');
    },
  });

  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="mt-4">
      {/* Group header — same style as the small-caps section labels in
          the settings rail. The "+" button stays inline so creating a
          new collection is one click away no matter how many already
          exist. */}
      <div className="mb-1 flex items-center gap-1 px-2">
        <p className="flex-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Collections
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="New collection"
          title="New collection"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {showCreate && (
        <div className="mb-1 space-y-1 rounded-md border border-border bg-card/50 px-2 py-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Collection name"
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) createMutation.mutate();
              if (e.key === 'Escape') setShowCreate(false);
            }}
          />
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={newPrivate}
              onChange={(e) => setNewPrivate(e.target.checked)}
              className="rounded border-input"
            />
            Private (only visible to you)
          </label>
        </div>
      )}

      {cols?.length === 0 && !showCreate ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">No collections yet</p>
      ) : (
        <ul className="space-y-0.5">
          {cols?.map((col) => {
            const isActive = pathname === `/collections/${col.id}`;
            const isPrivate = (col as { isPrivate?: boolean }).isPrivate ?? false;
            return (
              <li key={col.id} className="group relative">
                <button
                  onClick={() => router.push(`/collections/${col.id}`)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                >
                  <LayoutList
                    className="h-4 w-4 shrink-0"
                    style={col.color ? { color: col.color } : {}}
                    aria-hidden="true"
                  />
                  <span className="truncate">{col.name}</span>
                  {isPrivate ? (
                    <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" aria-label="Private" />
                  ) : (
                    <Globe className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" aria-label="Shared" />
                  )}
                  <span className="ml-auto pr-5 text-[10px] text-muted-foreground">
                    {col.itemCount}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete collection "${col.name}"? Items will be removed from the collection but not deleted.`)) {
                      deleteMutation.mutate(col.id);
                    }
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Delete ${col.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SidebarFooterLinks() {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>Search</span>
        <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      <a
        href="/settings"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
        <span>Settings</span>
      </a>
    </div>
  );
}

function UserSection() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="mt-2 border-t border-sidebar-border pt-2">
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{user.displayName}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {user.roles.map((r) => r.systemRole).join(', ')}
          </p>
        </div>
        <button
            onClick={() => logout()}
            className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
      </div>
    </div>
  );
}
