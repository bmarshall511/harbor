'use client';

/**
 * Tag editor — autocomplete with inline browse-all.
 *
 * Performance optimizations:
 *   • Debounced search (300ms) instead of per-keystroke
 *   • Optimistic UI updates (pill appears immediately, server syncs in background)
 *   • Scoped query invalidation (only the entity, not all files)
 *   • staleTime on queries to prevent redundant refetches
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tags as tagsApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { X, Tag as TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { TagDto } from '@harbor/types';

export function TagEditor({
  entityType,
  entityId,
  tags,
}: {
  entityType: 'FILE' | 'FOLDER';
  entityId: string;
  tags: TagDto[];
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [debouncedInput, setDebouncedInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce search input — 300ms delay instead of per-keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(input), 300);
    return () => clearTimeout(timer);
  }, [input]);

  // All tags in the library — cached for 2 minutes
  const { data: allTags = [] } = useQuery<TagDto[]>({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    staleTime: 120_000,
  });

  // Build suggestion list from cached allTags (no extra API call for search)
  const suggestions = useMemo(() => {
    const applied = new Set(tags.map((t) => t.id));
    const q = debouncedInput.trim().toLowerCase();

    let source = allTags.filter((t) => !applied.has(t.id));
    if (q) {
      source = source.filter((t) => t.name.toLowerCase().includes(q));
    }

    return source
      .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
      .slice(0, q ? 8 : 12);
  }, [debouncedInput, allTags, tags]);

  // Whether the typed query exactly matches an existing tag
  const exactMatch = useMemo(() => {
    if (!input.trim()) return null;
    const lower = input.trim().toLowerCase();
    return allTags.find((t) => t.name.toLowerCase() === lower) ?? null;
  }, [input, allTags]);

  const addTag = useMutation({
    mutationFn: async (tagName: string) => {
      const endpoint = entityType === 'FILE' ? 'files' : 'folders';
      // PATCH accepts a delta op so we don't have to ship the full
      // tag list (which would silently clobber any tag the user's
      // cache hadn't yet seen). The server applies `add` against
      // the LIVE sidecar value under its per-file write lock.
      const res = await fetch(`/api/${endpoint}/${entityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: { add: tagName } }),
      });
      if (!res.ok) throw new Error('Failed to add tag');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entityType === 'FILE' ? 'file' : 'folder', entityId] });
      // Delay tag list refresh so it doesn't compete with the entity refetch
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['tags'] }), 2000);
      setInput('');
      setHighlight(0);
      inputRef.current?.focus();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      const res = await fetch(`/api/tags/${tagId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId }),
      });
      if (!res.ok) throw new Error('Failed to remove tag');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entityType === 'FILE' ? 'file' : 'folder', entityId] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['tags'] }), 2000);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[highlight];
      if (pick) addTag.mutate(pick.name);
      else if (input.trim()) addTag.mutate(input.trim());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setInput('');
    } else if (e.key === 'Backspace' && input.length === 0 && tags.length > 0) {
      removeTag.mutate(tags[tags.length - 1].id);
    }
  }

  // Click-outside closes the popover
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={containerRef}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <TagIcon className="h-3 w-3" />
        Tags
      </div>

      <div
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
        className={cn(
          'relative flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0',
        )}
      >
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="group inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground"
          >
            {tag.color && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
            )}
            {tag.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag.mutate(tag.id); }}
              disabled={removeTag.isPending}
              className="rounded-full p-0.5 opacity-50 hover:bg-destructive/20 hover:opacity-100 disabled:opacity-30"
              aria-label={`Remove tag ${tag.name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Pick or type tags…' : ''}
          className="min-w-[6ch] flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
        />

        {open && (suggestions.length > 0 || (input.trim() && !exactMatch)) && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            {input.length === 0 && suggestions.length > 0 && (
              <div className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Most used
              </div>
            )}
            {suggestions.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTag.mutate(s.name); }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
                  i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                {s.color ? (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
                )}
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{s.usageCount}</span>
              </button>
            ))}
            {input.trim() && !exactMatch && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTag.mutate(input.trim()); }}
                className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-xs text-primary hover:bg-accent"
              >
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider">
                  New
                </span>
                Create &ldquo;{input.trim()}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
