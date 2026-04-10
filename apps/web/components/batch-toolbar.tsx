'use client';

/**
 * Batch toolbar — appears when the user has one or more file cards
 * checked in the current directory. Provides bulk:
 *
 *   • Tag (free-text comma list)
 *   • People (autocomplete: registered users + remembered free-text)
 *   • Multiselect fields (e.g. Adult Content) — one popover per
 *     configured field, chips toggled on/off and applied to all
 *     selected files
 *   • Move (folder picker)
 *   • Delete (with inline confirm)
 *
 * The popovers are full reuses of the same People + Multiselect logic
 * the per-file editor uses, so the UX is identical and any future
 * improvements to one carries over.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import {
  X, Trash2, FolderInput, Tag, Users, Loader2, AlertTriangle, Sparkles, ChevronDown,
} from 'lucide-react';
import { MoveToFolderPicker } from '@/components/move-to-folder-picker';
import { toast } from 'sonner';
import { users as usersApi } from '@/lib/api';
import { cn } from '@/lib/cn';

interface FieldTemplate {
  id: string;
  name: string;
  key: string;
  fieldType: string;
  options: Array<{ value: string; label: string }>;
}

type Person = { kind: 'user'; id: string; name: string } | { kind: 'free'; name: string };

export function BatchToolbar() {
  const selectedFileIds = useAppStore((s) => s.selectedFileIds);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const queryClient = useQueryClient();

  const [openPanel, setOpenPanel] = useState<
    | { kind: 'tag' }
    | { kind: 'people'; field: FieldTemplate }
    | { kind: 'multiselect'; field: FieldTemplate }
    | { kind: 'move' }
    | { kind: 'delete' }
    | null
  >(null);

  // Pull metadata field templates so we can offer a button per
  // multiselect / people field instead of hard-coding "adult content".
  const { data: fields = [] } = useQuery<FieldTemplate[]>({
    queryKey: ['metadata-fields'],
    queryFn: async () => {
      const r = await fetch('/api/metadata-fields');
      return r.json();
    },
    staleTime: 60_000,
  });

  const peopleFields = useMemo(() => fields.filter((f) => f.fieldType === 'people'), [fields]);
  const multiselectFields = useMemo(
    () => fields.filter((f) => f.fieldType === 'multiselect' && f.options?.length > 0),
    [fields],
  );

  const count = selectedFileIds.size;
  if (count === 0) return null;

  const fileIds = Array.from(selectedFileIds);

  function close() {
    setOpenPanel(null);
  }

  function refreshAfter() {
    queryClient.invalidateQueries({ queryKey: ['files'] });
    queryClient.invalidateQueries({ queryKey: ['file'] });
    queryClient.invalidateQueries({ queryKey: ['recommendations'] });
  }

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-primary/20 bg-primary/5 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {count}
          </span>
          <span className="text-xs font-medium text-muted-foreground">selected</span>

          <div className="ml-auto flex flex-wrap items-center gap-1">
            <ToolbarButton icon={Tag} label="Tag" onClick={() => setOpenPanel({ kind: 'tag' })} />

            {peopleFields.map((f) => (
              <ToolbarButton
                key={f.id}
                icon={Users}
                label={f.name}
                onClick={() => setOpenPanel({ kind: 'people', field: f })}
              />
            ))}

            {multiselectFields.map((f) => (
              <ToolbarButton
                key={f.id}
                icon={Sparkles}
                label={f.name}
                onClick={() => setOpenPanel({ kind: 'multiselect', field: f })}
              />
            ))}

            <ToolbarButton icon={FolderInput} label="Move" onClick={() => setOpenPanel({ kind: 'move' })} />

            <BatchDeleteButton
              fileIds={fileIds}
              onDone={() => { clearSelection(); refreshAfter(); }}
            />

            <button
              onClick={clearSelection}
              className="ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {openPanel?.kind === 'tag' && (
        <BatchPopover title={`Add tags to ${count} files`} onClose={close}>
          <TagInputBar
            onApply={async (tags) => {
              const res = await fetch('/api/files/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'addTags', fileIds, tags }),
              });
              if (!res.ok) throw new Error('Failed');
              const data = await res.json();
              refreshAfter();
              toast.success(`Tagged ${data.success} file${data.success === 1 ? '' : 's'}`);
              close();
            }}
          />
        </BatchPopover>
      )}

      {openPanel?.kind === 'people' && (
        <BatchPopover title={`Add ${openPanel.field.name} to ${count} files`} onClose={close}>
          <BatchPeoplePicker
            field={openPanel.field}
            onApply={async (people) => {
              const res = await fetch('/api/files/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'addPeople',
                  fileIds,
                  fieldKey: openPanel.field.key,
                  people,
                }),
              });
              if (!res.ok) throw new Error('Failed');
              const data = await res.json();
              refreshAfter();
              toast.success(`Updated ${data.success} file${data.success === 1 ? '' : 's'}`);
              close();
            }}
          />
        </BatchPopover>
      )}

      {openPanel?.kind === 'multiselect' && (
        <BatchPopover title={`Set ${openPanel.field.name} on ${count} files`} onClose={close}>
          <BatchMultiselectPicker
            field={openPanel.field}
            onApply={async (values) => {
              const res = await fetch('/api/files/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'setMultiselect',
                  fileIds,
                  fieldKey: openPanel.field.key,
                  values,
                }),
              });
              if (!res.ok) throw new Error('Failed');
              const data = await res.json();
              refreshAfter();
              toast.success(`Updated ${data.success} file${data.success === 1 ? '' : 's'}`);
              close();
            }}
          />
        </BatchPopover>
      )}

      {openPanel?.kind === 'move' && (
        <BatchMoveDialog
          fileIds={fileIds}
          onDone={() => {
            close();
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
          }}
          onCancel={close}
        />
      )}
    </>
  );
}

// ─── Toolbar primitives ───────────────────────────────────────────

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Tag;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function BatchPopover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Tag picker ────────────────────────────────────────────────────

function TagInputBar({ onApply }: { onApply: (tags: string[]) => Promise<void> }) {
  const [input, setInput] = useState('');
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    const tags = input.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setApplying(true);
    try {
      await onApply(tags);
    } catch {
      toast.error('Failed to apply tags');
    }
    setApplying(false);
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="tag1, tag2, tag3"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
      />
      <p className="text-[10px] text-muted-foreground">
        Comma-separated. Existing tags on each file are preserved.
      </p>
      <div className="flex justify-end">
        <button
          onClick={handleApply}
          disabled={applying || !input.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

// ─── People picker (bulk) ─────────────────────────────────────────

function BatchPeoplePicker({
  field,
  onApply,
}: {
  field: FieldTemplate;
  onApply: (people: Person[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<Person[]>([]);
  const [applying, setApplying] = useState(false);

  const { data: registered = [] } = useQuery({
    queryKey: ['users-picker'],
    queryFn: usersApi.picker,
  });

  const { data: remembered = [] } = useQuery({
    queryKey: ['people-suggestions', field.key],
    queryFn: async () => {
      const r = await fetch(`/api/people-suggestions?fieldKey=${encodeURIComponent(field.key)}`);
      if (!r.ok) return [] as string[];
      return (await r.json()) as string[];
    },
    staleTime: 60_000,
  });

  function personKey(p: Person) {
    return p.kind === 'user' ? `u:${p.id}` : `f:${p.name.toLowerCase()}`;
  }

  function add(p: Person) {
    if (selected.some((x) => personKey(x) === personKey(p))) return;
    setSelected((s) => [...s, p]);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  }

  function remove(p: Person) {
    setSelected((s) => s.filter((x) => personKey(x) !== personKey(p)));
  }

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Array<{ key: string; person: Person; label: string; sub?: string }> = [];

    for (const u of registered) {
      const display = u.displayName || u.username;
      if (q && !display.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) continue;
      const person: Person = { kind: 'user', id: u.id, name: display };
      if (selected.some((p) => personKey(p) === personKey(person))) continue;
      items.push({ key: `u:${u.id}`, person, label: display, sub: `@${u.username}` });
    }
    for (const name of remembered) {
      if (q && !name.toLowerCase().includes(q)) continue;
      const person: Person = { kind: 'free', name };
      if (selected.some((p) => personKey(p) === personKey(person))) continue;
      if (items.some((i) => i.label.toLowerCase() === name.toLowerCase())) continue;
      items.push({ key: `f:${name}`, person, label: name });
    }
    if (q && !items.some((i) => i.label.toLowerCase() === q)) {
      items.push({
        key: `new:${q}`,
        person: { kind: 'free', name: query.trim() },
        label: query.trim(),
        sub: 'Add as new',
      });
    }
    return items.slice(0, 8);
  }, [registered, remembered, selected, query]);

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <span
              key={personKey(p)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                p.kind === 'user'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-foreground',
              )}
            >
              <span className="max-w-[14ch] truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => remove(p)}
                className="rounded-full p-0.5 opacity-50 hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          placeholder="Search people…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const pick = suggestions[highlight];
              if (pick) add(pick.person);
              else if (query.trim()) add({ kind: 'free', name: query.trim() });
            }
          }}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(s.person); }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs',
                  i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <span className="truncate">{s.label}</span>
                {s.sub && <span className="ml-2 text-[10px] text-muted-foreground">{s.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Existing entries on each file are kept; new ones are merged in.
      </p>

      <div className="flex justify-end">
        <button
          onClick={async () => {
            if (selected.length === 0) return;
            setApplying(true);
            try { await onApply(selected); }
            catch { toast.error('Failed to update files'); }
            setApplying(false);
          }}
          disabled={applying || selected.length === 0}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {applying ? 'Applying…' : `Apply to all`}
        </button>
      </div>
    </div>
  );
}

// ─── Multiselect picker (bulk) ────────────────────────────────────

function BatchMultiselectPicker({
  field,
  onApply,
}: {
  field: FieldTemplate;
  onApply: (values: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  function toggle(value: string) {
    setSelected((s) => (s.includes(value) ? s.filter((v) => v !== value) : [...s, value]));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                isOn
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        These values will <strong>replace</strong> any existing values on the selected files.
        Leave empty and apply to clear.
      </p>
      <div className="flex justify-end">
        <button
          onClick={async () => {
            setApplying(true);
            try { await onApply(selected); }
            catch { toast.error('Failed to update files'); }
            setApplying(false);
          }}
          disabled={applying}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply to all'}
        </button>
      </div>
    </div>
  );
}

// ─── Move dialog ──────────────────────────────────────────────────

function BatchMoveDialog({
  fileIds,
  onDone,
  onCancel,
}: {
  fileIds: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [moving, setMoving] = useState(false);

  const handleMove = async (folderId: string, folderName: string) => {
    setMoving(true);
    try {
      const res = await fetch('/api/files/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', fileIds, targetFolderId: folderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Move failed');
      }
      const data = await res.json();
      toast.success(`Moved ${data.success} file(s) to "${folderName}"`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Batch move failed');
      setMoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm">
        {moving ? (
          <div className="rounded-lg border border-border bg-popover p-8 text-center shadow-lg">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">Moving {fileIds.length} file(s)...</p>
          </div>
        ) : (
          <div>
            <div className="mb-2 text-center">
              <p className="text-sm font-medium text-white">Move {fileIds.length} file(s) to...</p>
            </div>
            <MoveToFolderPicker onSelect={handleMove} onCancel={onCancel} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Delete (inline confirm) ──────────────────────────────────────

function BatchDeleteButton({ fileIds, onDone }: { fileIds: string[]; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-destructive">Delete {fileIds.length} file(s)?</span>
        <button
          onClick={async () => {
            setDeleting(true);
            try {
              const res = await fetch('/api/files/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', fileIds }),
              });
              const data = await res.json();
              toast.success(`Deleted ${data.success} file(s)`);
              onDone();
            } catch {
              toast.error('Batch delete failed');
            }
            setDeleting(false);
            setConfirming(false);
          }}
          disabled={deleting}
          className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
          Confirm
        </button>
        <button onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Delete
    </button>
  );
}
