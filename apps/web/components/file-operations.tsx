'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { files as filesApi, folders as foldersApi } from '@/lib/api';
import { getMimeCategory } from '@harbor/utils';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { Pencil, Trash2, FolderPlus, AlertTriangle, Wand2, Pen, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

// ── Rename Dialog ───────────────────────────────────────────────
//
// Two modes:
//
//   1. Manual — free-text rename (one input, the original behavior).
//
//   2. Format — structured rename. The dialog renders the filename
//      as three pieces side-by-side:
//
//          [ DATE ]   _   [ LABEL ]   _   [ NUMBER ]   .ext
//
//      • DATE is picked by the user via a dedicated Date control
//        below the filename pieces. The control has a native date
//        picker (keyboard + screen-reader friendly), a segmented
//        format switch (ISO / Decade / Unknown), and a Reset button
//        that reverts to the file's original creation date.
//      • LABEL is a free-text input that defaults to "photo" for
//        images and "video" for videos. The user can type whatever
//        they want here ("birthday", "trip-2019", etc.).
//      • NUMBER is a 3-digit sequence the user can edit.
//      • The extension is shown locked at the right side, computed
//        from the original filename — no picker needed.
//
//      A live preview of the full filename is shown below. When the
//      user picks a date, it is sent to the API as `fileCreatedAt`
//      and written through the canonical metadata sidecar so future
//      reindexes preserve it.

interface RenameDialogProps {
  entityType: 'file' | 'folder';
  entityId: string;
  currentName: string;
  /** Original mime type (so we can default the label to photo/video). */
  mimeType?: string | null;
  /** Original ISO file-created timestamp (when known). */
  fileCreatedAt?: string | null;
  /** Original ISO file-modified timestamp (when known). */
  fileModifiedAt?: string | null;
  onClose: () => void;
}

type DateFormat = 'iso' | 'decade' | 'unknown';

export function RenameDialog({
  entityType,
  entityId,
  currentName,
  mimeType,
  fileCreatedAt,
  fileModifiedAt,
  onClose,
}: RenameDialogProps) {
  const queryClient = useQueryClient();
  // Files default to the structured Format tab (the common case for
  // a renaming user); folders only have manual rename available.
  const [tab, setTab] = useState<'manual' | 'format'>(entityType === 'file' ? 'format' : 'manual');
  const [name, setName] = useState(currentName);

  // Format-mode state — `seq` is a *string* so the user can type
  // leading zeros like "001". A number input cannot represent that.
  // Default to `unknown` when the file has no creation or modified
  // date — avoids putting today's date on a file the user knows
  // nothing about.
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    fileCreatedAt || fileModifiedAt ? 'iso' : 'unknown',
  );
  const [seq, setSeq] = useState('001');

  // Default label is media-type aware: "photo" for images, "video" for
  // videos, "file" for anything else.
  const defaultLabel = useMemo(() => {
    const cat = getMimeCategory(mimeType ?? null);
    if (cat === 'image') return 'photo';
    if (cat === 'video') return 'video';
    return 'file';
  }, [mimeType]);
  const [label, setLabel] = useState(defaultLabel);
  useEffect(() => { setLabel(defaultLabel); }, [defaultLabel]);

  // The canonical "original" date we reset to: file creation if known,
  // otherwise modified, otherwise null (the picker stays empty and the
  // format stays `unknown` until the user picks something).
  const originalDate = useMemo<Date | null>(() => {
    if (fileCreatedAt) return new Date(fileCreatedAt);
    if (fileModifiedAt) return new Date(fileModifiedAt);
    return null;
  }, [fileCreatedAt, fileModifiedAt]);

  // The date the user is currently working with. Starts at the
  // original; edited by the date picker and the Reset button.
  const [pickedDate, setPickedDate] = useState<Date | null>(originalDate);
  // Date used to render the filename preview. Falls back to today
  // only when the format is not `unknown` AND the picker is empty —
  // that's the "I have no date, use today" path the old code took.
  const previewDate = pickedDate ?? new Date();

  // Extension is fixed and dynamic (taken from the original filename).
  const ext = useMemo(() => extractExtension(currentName), [currentName]);

  // Sanitize the label for filesystems: drop slashes, collapse
  // whitespace into single underscores, remove leading/trailing
  // separators. We do this only for the *built* name, not the input,
  // so the user still sees what they typed.
  const sanitizedLabel = useMemo(() => sanitizeLabelForFilename(label || defaultLabel), [label, defaultLabel]);

  const datePart = useMemo(() => {
    if (dateFormat === 'unknown') return 'unknown_date';
    if (dateFormat === 'decade') return decadeBucket(previewDate);
    return isoDate(previewDate);
  }, [dateFormat, previewDate]);

  // Sequence is a free-text field — we sanitize at preview build
  // time so the user can type "001", "12a", "v2", etc.
  const sanitizedSeq = useMemo(() => sanitizeSeqForFilename(seq), [seq]);

  const previewName = useMemo(() => {
    return `${datePart}_${sanitizedLabel}_${sanitizedSeq}${ext}`;
  }, [datePart, sanitizedLabel, sanitizedSeq, ext]);

  const targetName = tab === 'manual' ? name : previewName;

  // Has the user moved the picked date off the original? Compared by
  // calendar-day identity (toLocalDateInputValue) so timezone rounding
  // doesn't produce a false "dirty" flag.
  const dateChanged = useMemo(() => {
    if (tab !== 'format') return false;
    return toLocalDateInputValue(pickedDate) !== toLocalDateInputValue(originalDate);
  }, [tab, pickedDate, originalDate]);

  const nameChanged = targetName.trim().length > 0 && targetName !== currentName;

  const mutation = useMutation({
    mutationFn: async () => {
      if (entityType === 'file') {
        const update: { newName?: string; fileCreatedAt?: string | null } = {};
        if (nameChanged) update.newName = targetName;
        if (dateChanged) {
          update.fileCreatedAt = pickedDate ? pickedDate.toISOString() : null;
        }
        return filesApi.rename(entityId, update);
      }
      return foldersApi.update(entityId, { description: undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entityType === 'file' ? 'files' : 'folders'] });
      queryClient.invalidateQueries({ queryKey: [entityType === 'file' ? 'file' : 'folder', entityId] });
      toast.success(`${entityType === 'file' ? 'File' : 'Folder'} renamed`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disabled =
    mutation.isPending ||
    !targetName.trim() ||
    (!nameChanged && !dateChanged);

  return (
    <DialogOverlay onClose={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-popover p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Rename {entityType}</h3>
        </div>

        {/* Tabs */}
        {entityType === 'file' && (
          <div className="mt-3 flex gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setTab('manual')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition',
                tab === 'manual' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Pen className="h-3 w-3" /> Manual
            </button>
            <button
              type="button"
              onClick={() => setTab('format')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition',
                tab === 'format' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Wand2 className="h-3 w-3" /> Format
            </button>
          </div>
        )}

        {tab === 'manual' || entityType === 'folder' ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') mutation.mutate(); }}
          />
        ) : (
          <div className="mt-3 space-y-3">
            {/* Inline three-piece editor: date | label | number . ext */}
            <div className="rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
                {/* Date — non-interactive display; edited via the
                    Date control row below. */}
                <span
                  className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
                  title="Edit the date below"
                >
                  {datePart}
                </span>
                <Sep />
                {/* Label — editable, defaults to photo/video/file */}
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={defaultLabel}
                  className="w-32 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Label"
                />
                <Sep />
                {/* Sequence — text so leading zeros (001) work */}
                <input
                  type="text"
                  inputMode="text"
                  value={seq}
                  onChange={(e) => setSeq(e.target.value)}
                  placeholder="001"
                  maxLength={8}
                  aria-label="Sequence"
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-center font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {/* Extension — fixed, derived from the file */}
                {ext ? (
                  <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground" title="Extension is preserved automatically">
                    {ext}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Date control row */}
            <DateControlRow
              pickedDate={pickedDate}
              originalDate={originalDate}
              dateFormat={dateFormat}
              onPickDate={(d) => {
                setPickedDate(d);
                // Picking a real date in unknown mode implies the
                // user wants a real date in the filename — jump to
                // ISO so the preview reflects it immediately.
                if (d && dateFormat === 'unknown') setDateFormat('iso');
              }}
              onFormatChange={setDateFormat}
              onReset={() => {
                setPickedDate(originalDate);
                setDateFormat(originalDate ? 'iso' : 'unknown');
              }}
            />

            {/* Live preview */}
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview</p>
              <code className="mt-0.5 block break-all text-xs font-medium">{previewName}</code>
              {dateChanged && (
                <p className="mt-1 text-[10px] text-primary/80">
                  Saved in Harbor only — the file's own timestamps are left alone.
                </p>
              )}
              {dateFormat !== 'unknown' && !pickedDate && (
                <p className="mt-1 text-[10px] text-amber-500/80">
                  No creation date on file — using today.
                  Switch to <code className="rounded bg-muted px-1">unknown_date</code> below
                  if you'd rather leave the date blank.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={disabled}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

function Sep() {
  return <span className="text-muted-foreground">_</span>;
}

// ── Date control row (format mode) ──────────────────────────────
//
// Native `<input type="date">` for the actual date, plus a segmented
// control for how the date renders in the filename (ISO / Decade /
// Unknown), plus a Reset button that reverts to the original
// creation date from the file's metadata. The native input is used
// deliberately: it's keyboard-navigable, screen-reader-labelled,
// locale-aware, and pulls in zero dependencies.

interface DateControlRowProps {
  pickedDate: Date | null;
  originalDate: Date | null;
  dateFormat: DateFormat;
  onPickDate: (d: Date | null) => void;
  onFormatChange: (f: DateFormat) => void;
  onReset: () => void;
}

function DateControlRow({
  pickedDate,
  originalDate,
  dateFormat,
  onPickDate,
  onFormatChange,
  onReset,
}: DateControlRowProps) {
  const inputValue = toLocalDateInputValue(pickedDate);
  const hasOriginal = originalDate !== null;
  const isDirty =
    toLocalDateInputValue(pickedDate) !== toLocalDateInputValue(originalDate);

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Date
        </label>
        <button
          type="button"
          onClick={onReset}
          disabled={!isDirty}
          aria-label="Reset date to original"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={inputValue}
          onChange={(e) => {
            const next = fromLocalDateInputValue(e.target.value);
            onPickDate(next);
          }}
          aria-label="Creation date"
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div role="radiogroup" aria-label="Date format" className="flex gap-0.5 rounded-md border border-border p-0.5">
          <FormatPill
            label="ISO"
            active={dateFormat === 'iso'}
            onClick={() => onFormatChange('iso')}
            title="YYYY-MM-DD"
          />
          <FormatPill
            label="Decade"
            active={dateFormat === 'decade'}
            onClick={() => onFormatChange('decade')}
            title="YYYYs"
          />
          <FormatPill
            label="Unknown"
            active={dateFormat === 'unknown'}
            onClick={() => onFormatChange('unknown')}
            title="unknown_date"
          />
        </div>
      </div>

      {!hasOriginal && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          This file has no stored creation date. Pick one to save it.
        </p>
      )}
    </div>
  );
}

function FormatPill({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-[4px] px-2 py-0.5 text-[10px] font-medium transition',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

// ── Format helpers ──────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert a `Date` into the `YYYY-MM-DD` string the native
 * `<input type="date">` expects, using the user's **local**
 * calendar day. Returns `''` for a null date (an empty input).
 * Must match `isoDate` — that's why we use the same local-time
 * accessors instead of `toISOString().slice(0, 10)` (which is UTC
 * and will occasionally be a day off).
 */
function toLocalDateInputValue(d: Date | null): string {
  if (!d) return '';
  return isoDate(d);
}

/**
 * Parse the `YYYY-MM-DD` string out of a native date input into a
 * `Date` anchored at local midnight. Returns `null` for an empty
 * string (the user cleared the field).
 */
function fromLocalDateInputValue(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function decadeBucket(d: Date): string {
  const decade = Math.floor(d.getFullYear() / 10) * 10;
  return `${decade}s`;
}

function extractExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot);
}

/**
 * Make a user-typed label safe for use inside a filename:
 *   • Strip path separators
 *   • Collapse whitespace into single underscores
 *   • Remove leading/trailing separator characters
 *   • Fall back to "file" if the result is empty
 */
function sanitizeLabelForFilename(input: string): string {
  const cleaned = input
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return cleaned || 'file';
}

/**
 * Sequence is a free-text field so users can type literal `001`,
 * `12a`, `v2`, etc. We strip path separators and whitespace, but
 * preserve digits, letters, hyphens, and underscores. Falls back
 * to `001` if the user clears the field entirely.
 */
function sanitizeSeqForFilename(input: string): string {
  const cleaned = input
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned || '001';
}

// ── Mark For Delete (file) ───────────────────────────────────────
//
// This used to be `DeleteConfirmDialog` and would call DELETE on the
// file directly. Now it sends the file to the admin delete queue:
// the file is hidden from listings immediately, but the bytes stay
// on disk until an admin approves the request from the admin
// "Delete Queue" page. The dialog explains this clearly so the user
// knows nothing is permanently lost yet.
//
// Folders still use the legacy hard-delete because folder removal
// is admin-only and rarer; we keep both paths from this component.

export function DeleteConfirmDialog({
  entityType,
  entityId,
  entityName,
  onClose,
}: {
  entityType: 'file' | 'folder';
  entityId: string;
  entityName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const closeDetailPanel = useAppStore((s) => s.closeDetailPanel);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (entityType === 'file') {
        const res = await fetch(`/api/files/${entityId}/delete-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() || undefined }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to mark file for delete');
        }
        return res.json();
      }
      // Folder removal stays as a hard delete for now (admin-only).
      return foldersApi.delete(entityId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entityType === 'file' ? 'files' : 'folders'] });
      queryClient.invalidateQueries({ queryKey: ['file', entityId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'delete-queue'] });
      toast.success(
        entityType === 'file'
          ? 'Queued for deletion'
          : 'Folder deleted',
      );
      closeDetailPanel();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isFile = entityType === 'file';

  return (
    <DialogOverlay onClose={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-4 shadow-lg">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-sm font-semibold">
            {isFile ? 'Mark for delete?' : 'Delete folder?'}
          </h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {isFile ? (
            <>
              <strong className="text-foreground">{entityName}</strong> will be queued
              for deletion and removed from your library.
            </>
          ) : (
            <>
              Are you sure you want to delete <strong className="text-foreground">{entityName}</strong>?
              This will also remove all files and subfolders inside it. This action cannot be undone.
            </>
          )}
        </p>
        {isFile && (
          <div className="mt-3">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why is this being removed?"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {mutation.isPending
              ? (isFile ? 'Submitting…' : 'Deleting…')
              : (isFile ? 'Mark for delete' : 'Delete')}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

// ── Create Folder ───────────────────────────────────────────────

export function CreateFolderDialog({
  archiveRootId,
  parentId,
  onClose,
}: {
  archiveRootId: string;
  parentId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => foldersApi.create(archiveRootId, parentId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Folder created');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <DialogOverlay onClose={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-popover p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <FolderPlus className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">New Folder</h3>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) mutation.mutate(); }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

// ── Shared Dialog Overlay ───────────────────────────────────────

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}
