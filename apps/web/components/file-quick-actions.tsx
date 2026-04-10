'use client';

/**
 * Inline favorite + add-to-collection buttons for use on file cards
 * (and anywhere else a quick action is needed). Designed to render
 * compactly inside a card overlay — they appear on hover and are
 * fully self-contained (own queries, own mutations, own popover).
 *
 * Used by:
 *   • file-grid.tsx file cards
 *   • detail-panel.tsx
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, FolderPlus, Plus, Check } from 'lucide-react';
import { collections as collectionsApi, favorites as favoritesApi } from '@/lib/api';
import { cn } from '@/lib/cn';

interface FileQuickActionsProps {
  fileId: string;
  /** Visual size — `card` is for grid cards, `lg` for the detail panel. */
  size?: 'card' | 'lg';
  /** Render in dark-on-light or light-on-dark style. Default 'dark'. */
  variant?: 'dark' | 'light';
}

export function FileQuickActions({
  fileId,
  size = 'card',
  variant = 'dark',
}: FileQuickActionsProps) {
  const qc = useQueryClient();

  const { data: favs } = useQuery({ queryKey: ['favorites'], queryFn: favoritesApi.list });
  const isFav = favs?.some((f) => f.entityType === 'FILE' && f.entityId === fileId) ?? false;

  const favMut = useMutation({
    mutationFn: () => favoritesApi.toggle('FILE', fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const btn = cn(
    'grid place-items-center rounded-full transition',
    size === 'card' ? 'h-7 w-7' : 'h-9 w-9',
    variant === 'light'
      ? 'bg-white/90 text-neutral-800 ring-1 ring-black/5 backdrop-blur hover:bg-white shadow-sm'
      : 'bg-black/55 text-white ring-1 ring-white/10 backdrop-blur hover:bg-black/75',
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={isFav}
        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => { e.stopPropagation(); favMut.mutate(); }}
        className={cn(btn, isFav && (variant === 'light' ? 'text-rose-500' : 'text-rose-400'))}
      >
        <Heart className={cn(size === 'card' ? 'h-3.5 w-3.5' : 'h-4 w-4', isFav && 'fill-current')} />
      </button>
      <CollectionMenu fileId={fileId} size={size} variant={variant} />
    </div>
  );
}

function CollectionMenu({
  fileId,
  size,
  variant,
}: {
  fileId: string;
  size: 'card' | 'lg';
  variant: 'dark' | 'light';
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const { data: colls } = useQuery({ queryKey: ['collections'], queryFn: collectionsApi.list });
  const addMut = useMutation({
    mutationFn: (id: string) => collectionsApi.addItem(id, 'FILE', fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      setOpen(false);
    },
  });
  const newMut = useMutation({
    mutationFn: async () => {
      const c = await collectionsApi.create(name);
      await collectionsApi.addItem(c.id, 'FILE', fileId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      setOpen(false); setCreating(false); setName('');
    },
  });

  const btn = cn(
    'grid place-items-center rounded-full transition',
    size === 'card' ? 'h-7 w-7' : 'h-9 w-9',
    variant === 'light'
      ? 'bg-white/90 text-neutral-800 ring-1 ring-black/5 backdrop-blur hover:bg-white shadow-sm'
      : 'bg-black/55 text-white ring-1 ring-white/10 backdrop-blur hover:bg-black/75',
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Add to collection"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={btn}
      >
        <FolderPlus className={size === 'card' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div
            // Anchored above the button so it doesn't get clipped by
            // the card. z-50 sits above the backdrop and the cards.
            className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-popover p-1 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {colls && colls.length > 0 ? (
              <div className="max-h-64 overflow-y-auto">
                {colls.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); addMut.mutate(c.id); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <Check className="h-3 w-3 opacity-0" aria-hidden="true" />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No collections yet</p>
            )}
            <div className="mt-1 border-t border-border pt-1">
              {creating ? (
                <div className="flex gap-1 px-1 py-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Collection name"
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && name.trim()) newMut.mutate();
                      if (e.key === 'Escape') setCreating(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); name.trim() && newMut.mutate(); }}
                    className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setCreating(true); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> New collection
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
