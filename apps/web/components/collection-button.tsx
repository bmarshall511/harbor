'use client';

/**
 * Themed "Add to collection" button used by the detail panel and any
 * other in-app surface that needs to drop a file into a collection.
 *
 * Mirrors the lightbox's `CollectionButton` but uses theme tokens
 * (foreground/muted/accent) instead of hardcoded white-on-dark
 * colors so it sits naturally in the side panel and respects
 * dark/light parity.
 *
 * Behavior:
 *   • Pop the picker on click; list existing collections + their
 *     item counts.
 *   • "+ New collection" reveals a small inline form with a name
 *     field and a Private/Shared toggle.
 *   • On create, the new collection is created AND the current item
 *     is added in one shot, so the user never has to do two clicks.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Globe, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { collections as collectionsApi } from '@/lib/api';
import { cn } from '@/lib/cn';

interface CollectionButtonProps {
  entityType: 'FILE' | 'FOLDER';
  entityId: string;
}

export function CollectionButton({ entityType, entityId }: CollectionButtonProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Position the portal-rendered popover next to the trigger button.
  // The detail panel uses `overflow-y-auto`, which clipped the
  // popover when it was rendered as a sibling of the trigger. Rendering
  // into document.body via a portal escapes that clip, but we then
  // need to position it manually from the trigger's bounding rect.
  // Recomputed on open and on scroll/resize so it stays anchored.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = 288; // w-72
      const margin = 8;
      // Prefer to right-align with the trigger so the popover opens
      // back into the detail panel. Clamp to the viewport so it never
      // crosses the left edge of the screen on narrow viewports.
      const desiredLeft = rect.right - popoverWidth;
      const left = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, desiredLeft));
      const top = rect.bottom + 4;
      setCoords({ top, left });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  // Close on outside click. Both the trigger and the popover (which
  // now lives in a portal at document.body) are considered "inside".
  useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
      setCreating(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const { data: colls } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });

  const addMut = useMutation({
    mutationFn: (id: string) => collectionsApi.addItem(id, entityType, entityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      toast.success('Added to collection');
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const newMut = useMutation({
    mutationFn: async () => {
      const c = await collectionsApi.create(name.trim(), undefined, undefined, isPrivate);
      await collectionsApi.addItem(c.id, entityType, entityId);
      return c;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Added to "${c.name}"`);
      setOpen(false);
      setCreating(false);
      setName('');
      setIsPrivate(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const popover = open && coords && (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Add to collection"
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: 288 }}
      className="z-[60] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
    >
          {colls && colls.length > 0 ? (
            <div className="max-h-64 overflow-y-auto py-0.5">
              {colls.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addMut.mutate(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No collections yet</p>
          )}

          <div className="mt-1 border-t border-border pt-1">
            {creating ? (
              <div className="space-y-2 p-2">
                <input
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Collection name"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    e.nativeEvent.stopImmediatePropagation();
                    if (e.key === 'Enter' && name.trim()) newMut.mutate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                />
                <label className="flex items-center justify-between rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-foreground">
                  <span className="flex items-center gap-1.5">
                    {isPrivate ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                    {isPrivate ? 'Private collection' : 'Shared collection'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPrivate}
                    onClick={() => setIsPrivate((v) => !v)}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
                      isPrivate ? 'bg-primary' : 'bg-input',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform',
                        isPrivate ? 'translate-x-4' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </label>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setName(''); }}
                    className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => name.trim() && newMut.mutate()}
                    disabled={!name.trim() || newMut.isPending}
                    className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {newMut.isPending ? 'Creating…' : 'Create + add'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> New collection
              </button>
            )}
          </div>
        </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Add to collection"
        aria-expanded={open}
        title="Add to collection"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <FolderPlus className="h-3.5 w-3.5" />
      </button>
      {mounted && popover && createPortal(popover, document.body)}
    </>
  );
}
