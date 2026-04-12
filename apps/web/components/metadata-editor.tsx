'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { files as filesApi, folders as foldersApi, users as usersApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Pencil, Save, X, Star, Users, UserPlus, Check, PawPrint, User } from 'lucide-react';
import { AiSuggestButton } from '@/components/ai-suggest-button';
import { toast } from 'sonner';
import { TagEditor } from '@/components/tag-editor';
import { useAuth } from '@/lib/use-auth';
import type { FileDto, FolderDto } from '@harbor/types';

// ─── Field permission helpers ────────────────────────────────

/** Map template keys to their permission resource names. */
function fieldPermissionResource(key: string): string {
  const BUILTIN_MAP: Record<string, string> = {
    title: 'items.title',
    description: 'items.description',
    tags: 'items.tags',
    adult_content: 'items.adult_content',
    people: 'items.people',
    rating: 'items.file_metadata',
    caption: 'items.file_metadata',
    altText: 'items.file_metadata',
  };
  return BUILTIN_MAP[key] ?? `items.custom.${key}`;
}

// ─── People field types ───────────────────────────────────────

type Person =
  | { kind: 'user'; id: string; name: string }
  | { kind: 'free'; name: string };

interface FieldTemplate {
  id: string;
  name: string;
  key: string;
  fieldType: string;
  options: Array<{ value: string; label: string }>;
  appliesTo: string[];
  sortOrder: number;
}

// ─── File Metadata Editor ─────────────────────────────────────

export function FileMetadataEditor({ file }: { file: FileDto }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});

  // Permission helpers for field-level access
  const canView = (key: string) => hasPermission(fieldPermissionResource(key), 'view');
  const canEdit = (key: string) => hasPermission(fieldPermissionResource(key), 'edit');
  const canEditAny = ['title', 'description', 'tags', 'rating', 'people', 'adult_content'].some(
    (k) => canEdit(k),
  );

  // Load field templates
  const { data: fields } = useQuery<FieldTemplate[]>({
    queryKey: ['metadata-fields'],
    queryFn: async () => { const r = await fetch('/api/metadata-fields'); return r.json(); },
  });

  // Initialize form data from file. Only reset when navigating to a
  // different file (ID change), NOT on every refetch — otherwise
  // in-flight edits (e.g. AI suggestions applied but not yet saved)
  // get wiped by a background query invalidation.
  const prevFileIdRef = useRef(file.id);
  useEffect(() => {
    if (prevFileIdRef.current !== file.id || !editing) {
      const fields = file.meta?.fields ?? {};
      setFormData({
        title: file.title ?? '',
        description: file.description ?? '',
        caption: (fields.caption as string | undefined) ?? '',
        altText: (fields.altText as string | undefined) ?? '',
        rating: file.rating ?? 0,
      });
      prevFileIdRef.current = file.id;
    }
  }, [file.id, file.title, file.description, file.rating, file.meta, editing]);

  const setField = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const mutation = useMutation({
    mutationFn: (data: Record<string, any>) => filesApi.update(file.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', file.id] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['recently-viewed'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setEditing(false);
      toast.success('Saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSave = () => {
    // The PATCH route partitions known core keys (title, description,
    // rating) into `core` and everything else (caption, altText, ...)
    // into `fields` automatically.
    mutation.mutate({
      title: formData.title || null,
      description: formData.description || null,
      caption: formData.caption || null,
      altText: formData.altText || null,
      rating: formData.rating || null,
    });
  };

  // Filter fields applicable to this file type
  const mimeBase = file.mimeType?.split('/')[0] ?? '';
  const applicableFields = (fields ?? []).filter((f) => {
    if (f.appliesTo.includes('all')) return true;
    return f.appliesTo.includes(mimeBase);
  });

  // Map template keys to file values for display. Caption/altText
  // come from meta.fields now.
  const getFieldValue = (key: string): any => {
    const metaFields = file.meta?.fields ?? {};
    const builtins: Record<string, any> = {
      title: file.title,
      description: file.description,
      caption: metaFields.caption,
      altText: metaFields.altText,
      rating: file.rating,
    };
    if (key in builtins) return builtins[key] ?? null;
    return metaFields[key] ?? null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Details</h4>
        <div className="flex items-center gap-1">
          {canEditAny && (file.mimeType?.startsWith('image/') || file.previews?.length > 0) && (
            <AiSuggestButton
              fileId={file.id}
              onSelectTitle={(v) => {
                setFormData((prev) => ({ ...prev, title: v }));
                setEditing(true);
              }}
              onSelectDescription={(v) => {
                setFormData((prev) => ({ ...prev, description: v }));
                setEditing(true);
              }}
              onSelectTags={async (aiTags) => {
                try {
                  await filesApi.update(file.id, { tags: aiTags });
                  queryClient.invalidateQueries({ queryKey: ['file', file.id] });
                  queryClient.invalidateQueries({ queryKey: ['tags'] });
                } catch {
                  // Non-fatal
                }
              }}
            />
          )}
          {canEditAny && (editing ? (
            <>
              <button onClick={handleSave} disabled={mutation.isPending}
                className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <Save className="h-3 w-3" />
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              <Pencil className="h-3 w-3" /> Edit
            </button>
          ))}
        </div>
      </div>

      {/* Title + Description — permission-gated */}
      <div className="space-y-2">
        {canView('title') && (editing && canEdit('title') ? (
          <EditField label="Title" value={formData.title ?? ''} onChange={(v) => setField('title', v)} />
        ) : canView('title') ? (
          <ClickToEditField
            label="Title"
            value={file.title}
            placeholder={canEdit('title') ? 'Add a title...' : undefined}
            onEdit={canEdit('title') ? () => setEditing(true) : undefined}
          />
        ) : null)}
        {canView('description') && (editing && canEdit('description') ? (
          <EditField label="Description" value={formData.description ?? ''} onChange={(v) => setField('description', v)} multiline />
        ) : canView('description') ? (
          <ClickToEditField
            label="Description"
            value={file.description}
            placeholder={canEdit('description') ? 'Add a description...' : undefined}
            onEdit={canEdit('description') ? () => setEditing(true) : undefined}
          />
        ) : null)}
      </div>

      {/* Render remaining fields from templates in order */}
      <div className="space-y-2">
        {applicableFields.map((field) => {
          // Skip title/description — rendered above
          if (field.key === 'title' || field.key === 'description') return null;

          // Check field-level view permission
          if (!canView(field.key)) return null;

          const fieldEditable = canEdit(field.key);

          // Tags get their own dedicated editor
          if (field.key === 'tags') {
            return fieldEditable
              ? <TagEditor key={field.key} entityType="FILE" entityId={file.id} tags={file.tags} />
              : file.tags?.length ? (
                <div key={field.key}>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Tags</label>
                  <div className="flex flex-wrap gap-1">{file.tags.map((t: any) => (
                    <span key={t.tag?.name ?? t} className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t.tag?.name ?? t}</span>
                  ))}</div>
                </div>
              ) : null;
          }

          // Rating
          if (field.key === 'rating') {
            return editing && fieldEditable
              ? <RatingInput key={field.key} rating={formData.rating ?? 0} onChange={(r) => setField('rating', r)} />
              : <RatingDisplay key={field.key} rating={file.rating} />;
          }

          // People (registered users + free-text, autocomplete)
          if (field.fieldType === 'people') {
            return fieldEditable
              ? <PeopleField key={field.key} field={field} file={file} />
              : <ReadOnlyPeopleField key={field.key} field={field} file={file} />;
          }

          // Multiselect (e.g., adult content)
          if (field.fieldType === 'multiselect' && field.options.length > 0) {
            return fieldEditable
              ? <MultiselectField key={field.key} field={field} file={file} />
              : <ReadOnlyMultiselectField key={field.key} field={field} file={file} />;
          }

          // Text / textarea fields
          const value = getFieldValue(field.key);
          if (editing && fieldEditable) {
            return (
              <EditField key={field.key} label={field.name}
                value={formData[field.key] ?? ''} onChange={(v) => setField(field.key, v)}
                multiline={field.fieldType === 'textarea'}
              />
            );
          }

          if (value) {
            return <MetaField key={field.key} label={field.name} value={String(value)} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

// ─── Multiselect Field (inline save) ──────────────────────────
//
// Reads the current value from `file.meta.fields[field.key]` so
// toggling a chip persists *and* survives reloads. The PATCH route
// writes the JSON file (canonical) and mirrors it back into the DB
// row's `meta` column for fast read-back.

function MultiselectField({ field, file }: { field: FieldTemplate; file: FileDto }) {
  const queryClient = useQueryClient();
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initial = useMemo<string[]>(() => {
    const raw = file.meta?.fields?.[field.key];
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
    if (typeof raw === 'string' && raw.length > 0) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  }, [file, field.key]);

  const [selected, setSelected] = useState<string[]>(initial);
  // Only sync from server when the file ID changes (navigating to
  // a different file), NOT on every refetch — otherwise in-flight
  // mutations get their local state stomped by stale server data.
  const prevFileIdRef = useRef(file.id);
  useEffect(() => {
    if (prevFileIdRef.current !== file.id) {
      setSelected(initial);
      prevFileIdRef.current = file.id;
    }
  }, [file.id, initial]);

  const saveMutation = useMutation({
    mutationFn: (values: string[]) => filesApi.update(file.id, { [field.key]: values }),
    onSuccess: () => {
      // Debounce the invalidation so rapid toggles don't cause
      // competing refetches. Also refresh list queries so cards
      // show the updated title/tags/people immediately.
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['file', file.id] });
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['recommendations'] });
        queryClient.invalidateQueries({ queryKey: ['recently-viewed'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }, 1500);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    setSelected(next);
    saveMutation.mutate(next);
  };

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{field.name}</label>
      <div className="flex flex-wrap gap-1">
        {field.options.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <button key={opt.value} onClick={() => toggle(opt.value)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium border transition-colors',
                isOn ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30',
              )}>
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── People Field ─────────────────────────────────────────────
//
// Sleek autocomplete picker that lets users tag People on a file:
//   • Registered users (via /api/users/picker)
//   • Free-text people (entered manually, persisted alongside)
// Free-text entries become "remembered" — once added to any file
// they appear as suggestions on every other file too, so a user only
// has to type "Aunt Linda" once.

function PeopleField({ field, file }: { field: FieldTemplate; file: FileDto }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Current selection persisted on this file
  const initial = useMemo<Person[]>(() => normalizePeople(file.meta?.fields?.[field.key]), [file, field.key]);
  const [selected, setSelected] = useState<Person[]>(initial);
  // Only reset from server data when navigating to a different file,
  // not on every refetch (which would stomp in-flight edits).
  const prevFileIdRef = useRef(file.id);
  useEffect(() => {
    if (prevFileIdRef.current !== file.id) {
      setSelected(initial);
      prevFileIdRef.current = file.id;
    }
  }, [file.id, initial]);

  // Registered users (app accounts)
  const { data: registered = [] } = useQuery({
    queryKey: ['users-picker'],
    queryFn: usersApi.picker,
  });

  // Known Person records (from face detection + admin management)
  const { data: knownPersons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const r = await fetch('/api/persons');
      if (!r.ok) return [] as Array<{ id: string; name: string | null; avatarUrl: string | null; entityType?: string; faceCount: number; source: string }>;
      return (await r.json()) as Array<{ id: string; name: string | null; avatarUrl: string | null; entityType?: string; faceCount: number; source: string }>;
    },
    staleTime: 60_000,
  });

  // Remembered free-text people from previous files
  const { data: remembered = [] } = useQuery({
    queryKey: ['people-suggestions', field.key],
    queryFn: async () => {
      const r = await fetch(`/api/people-suggestions?fieldKey=${encodeURIComponent(field.key)}`);
      if (!r.ok) return [] as string[];
      return (await r.json()) as string[];
    },
    staleTime: 60_000,
  });

  const saveInvalidateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useMutation({
    mutationFn: (people: Person[]) => filesApi.update(file.id, { [field.key]: people }),
    onSuccess: () => {
      // Debounce invalidation to prevent refetch from resetting
      // other fields' in-flight edits (e.g. adult content).
      if (saveInvalidateRef.current) clearTimeout(saveInvalidateRef.current);
      saveInvalidateRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['file', file.id] });
        queryClient.invalidateQueries({ queryKey: ['people-suggestions', field.key] });
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['recommendations'] });
        queryClient.invalidateQueries({ queryKey: ['recently-viewed'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }, 1500);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function commit(next: Person[]) {
    setSelected(next);
    save.mutate(next);
  }

  function add(person: Person, focusInput = false) {
    if (selected.some((p) => personKey(p) === personKey(person))) return;
    commit([...selected, person]);
    setQuery('');
    setHighlight(0);
    if (focusInput) inputRef.current?.focus();
  }

  function remove(person: Person) {
    commit(selected.filter((p) => personKey(p) !== personKey(person)));
  }

  /**
   * If a free-text pill matches a registered user (case-insensitive
   * on display name OR username), the pill shows a one-click "link
   * to user" button. Clicking it converts the pill in place.
   */
  function matchingUserFor(person: Person): { id: string; displayName: string; username: string } | null {
    if (person.kind !== 'free') return null;
    const lower = person.name.trim().toLowerCase();
    if (!lower) return null;
    const match = registered.find((u) => {
      const display = (u.displayName || u.username).toLowerCase();
      return display === lower || u.username.toLowerCase() === lower;
    });
    return match ? { id: match.id, displayName: match.displayName || match.username, username: match.username } : null;
  }

  function linkToUser(freePerson: Person, user: { id: string; displayName: string; username: string }) {
    if (freePerson.kind !== 'free') return;
    const next = selected.map((p) => {
      if (personKey(p) !== personKey(freePerson)) return p;
      return { kind: 'user' as const, id: user.id, name: user.displayName };
    });
    // Drop any duplicate that may have already existed.
    const seen = new Set<string>();
    const deduped: Person[] = [];
    for (const p of next) {
      const k = personKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(p);
    }
    commit(deduped);
  }

  // Build the suggestion list — merges three sources:
  //   1. Person records (admin-managed + face-detection-created)
  //   2. Registered app users
  //   3. Remembered free-text names from previous file metadata
  // Deduped by lowercase name so the same person never appears twice.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Array<{ key: string; person: Person; label: string; sub?: string }> = [];
    const seenNames = new Set<string>();

    // 1. Person records first — these are the canonical source of truth
    for (const p of knownPersons) {
      if (!p.name) continue;
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const person: Person = { kind: 'free', name: p.name };
      if (selected.some((s) => personKey(s) === personKey(person))) continue;
      seenNames.add(p.name.toLowerCase());
      const isPet = p.entityType === 'PET';
      items.push({
        key: `p:${p.id}`,
        person,
        label: p.name,
        sub: isPet ? 'Pet' : p.faceCount > 0 ? `${p.faceCount} faces` : undefined,
      });
    }

    // 2. Registered app users
    for (const u of registered) {
      const display = u.displayName || u.username;
      if (seenNames.has(display.toLowerCase())) continue;
      if (q && !display.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) continue;
      const person: Person = { kind: 'user', id: u.id, name: display };
      if (selected.some((p) => personKey(p) === personKey(person))) continue;
      seenNames.add(display.toLowerCase());
      items.push({ key: `u:${u.id}`, person, label: display, sub: `@${u.username}` });
    }

    // 3. Remembered free-text names (cross-file memory)
    for (const name of remembered) {
      if (seenNames.has(name.toLowerCase())) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      const person: Person = { kind: 'free', name };
      if (selected.some((p) => personKey(p) === personKey(person))) continue;
      seenNames.add(name.toLowerCase());
      items.push({ key: `f:${name}`, person, label: name });
    }

    // 4. Allow adding the typed query as a brand new free-text person
    if (q && !seenNames.has(q)) {
      const person: Person = { kind: 'free', name: query.trim() };
      if (!selected.some((p) => personKey(p) === personKey(person))) {
        items.push({ key: `new:${q}`, person, label: query.trim(), sub: 'Add as new' });
      }
    }

    return items.slice(0, 10);
  }, [registered, knownPersons, remembered, selected, query]);

  // Quick-select: named persons with DB records for the avatar grid
  const quickSelectPeople = useMemo(() => {
    return knownPersons
      .filter((p) => p.name && p.source === 'record')
      .slice(0, 20);
  }, [knownPersons]);

  // Look up a person's avatar/entityType/id from known persons
  function personMeta(person: Person) {
    const name = person.name.toLowerCase();
    const match = knownPersons.find((p) => p.name?.toLowerCase() === name);
    return {
      id: match?.id ?? null,
      avatarUrl: match?.avatarUrl ?? null,
      avatarFileId: (match as any)?.avatarFileId ?? null,
      entityType: match?.entityType ?? 'PERSON',
    };
  }

  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Users className="h-3 w-3" />
        {knownPersons.some((p) => p.entityType === 'PET') ? 'People & Pets' : field.name}
      </label>

      {/* Avatar quick-select grid */}
      {quickSelectPeople.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {quickSelectPeople.map((p) => {
            const isPet = p.entityType === 'PET';
            const isSelected = selected.some((s) => s.name.toLowerCase() === p.name!.toLowerCase());
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const person: Person = { kind: 'free', name: p.name! };
                  if (isSelected) remove(person);
                  else add(person);
                }}
                className="group relative flex shrink-0 flex-col items-center gap-0.5"
                title={p.name!}
              >
                <div className={cn(
                  'relative flex h-9 w-9 items-center justify-center overflow-hidden transition-all',
                  isPet ? 'rounded-lg' : 'rounded-full',
                  isSelected
                    ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : 'ring-1 ring-border group-hover:ring-primary/50',
                )}>
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className={cn('h-full w-full object-cover', isPet ? 'rounded-lg' : 'rounded-full')} />
                  ) : isPet ? (
                    <PawPrint className="h-4 w-4 text-amber-500" />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/30">
                      <Check className="h-4 w-4 text-white drop-shadow" />
                    </div>
                  )}
                  {isPet && !isSelected && (
                    <div className="absolute -bottom-px -right-px flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500">
                      <PawPrint className="h-1.5 w-1.5 text-white" />
                    </div>
                  )}
                </div>
                <span className="max-w-[3rem] truncate text-[8px] text-muted-foreground">
                  {p.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected people — avatar pills */}
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((p) => {
            const matchUser = matchingUserFor(p);
            const meta = personMeta(p);
            const isPet = meta.entityType === 'PET';
            return (
              <span
                key={personKey(p)}
                className={cn(
                  'group inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]',
                  p.kind === 'user'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted text-foreground',
                )}
              >
                {/* Mini avatar */}
                <div className={cn(
                  'relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden',
                  isPet ? 'rounded-sm' : 'rounded-full',
                )}>
                  {meta.avatarUrl ? (
                    <img src={meta.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : isPet ? (
                    <PawPrint className="h-2.5 w-2.5 text-amber-500" />
                  ) : p.kind === 'user' ? (
                    <UserPlus className="h-2.5 w-2.5" />
                  ) : (
                    <User className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                </div>
                <span className="max-w-[10ch] truncate">{p.name}</span>
                {matchUser && (
                  <button
                    type="button"
                    onClick={() => linkToUser(p, matchUser)}
                    title={`Link to @${matchUser.username}`}
                    className="rounded-full bg-primary/15 px-1 text-[9px] font-medium text-primary hover:bg-primary/25"
                  >
                    → @{matchUser.username}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className="rounded-full p-0.5 opacity-50 transition-opacity hover:bg-black/10 hover:opacity-100"
                  aria-label={`Remove ${p.name}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Combobox */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={selected.length === 0 ? 'Add a person or pet…' : 'Add another…'}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
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
              if (pick) add(pick.person, true);
              else if (query.trim()) add({ kind: 'free', name: query.trim() }, true);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            } else if (e.key === 'Backspace' && query.length === 0 && selected.length > 0) {
              commit(selected.slice(0, -1));
            }
          }}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            {suggestions.map((s, i) => {
              const sMeta = personMeta(s.person);
              const isPet = sMeta.entityType === 'PET';
              return (
                <button
                  key={s.key}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(s.person, true); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    i === highlight ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
                  )}
                >
                  {/* Suggestion avatar */}
                  <div className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden',
                    isPet ? 'rounded-sm' : 'rounded-full',
                    'bg-muted',
                  )}>
                    {sMeta.avatarUrl ? (
                      <img src={sMeta.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : isPet ? (
                      <PawPrint className="h-2.5 w-2.5 text-amber-500" />
                    ) : s.person.kind === 'user' ? (
                      <UserPlus className="h-2.5 w-2.5 text-primary" />
                    ) : (
                      <User className="h-2.5 w-2.5 text-muted-foreground" />
                    )}
                  </div>
                  <span className="flex-1 truncate">{s.label}</span>
                  {s.sub && <span className="truncate text-[10px] text-muted-foreground">{s.sub}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function personKey(p: Person): string {
  return p.kind === 'user' ? `u:${p.id}` : `f:${p.name.toLowerCase()}`;
}

function normalizePeople(raw: unknown): Person[] {
  if (!Array.isArray(raw)) return [];
  const out: Person[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ kind: 'free', name: item.trim() });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (obj.kind === 'user' && typeof obj.id === 'string' && typeof obj.name === 'string') {
        out.push({ kind: 'user', id: obj.id, name: obj.name });
      } else if (typeof obj.name === 'string') {
        out.push({ kind: 'free', name: obj.name });
      }
    }
  }
  return out;
}

// ─── Read-only variants for view-only permissions ────────────

function ReadOnlyMultiselectField({ field, file }: { field: FieldTemplate; file: FileDto }) {
  const raw = file.meta?.fields?.[field.key];
  const values: string[] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  if (values.length === 0) return null;
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{field.name}</label>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => {
          const opt = field.options.find((o) => o.value === v);
          return (
            <span key={v} className="rounded-md border border-primary bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {opt?.label ?? v}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ReadOnlyPeopleField({ field, file }: { field: FieldTemplate; file: FileDto }) {
  const people = normalizePeople(file.meta?.fields?.[field.key]);
  if (people.length === 0) return null;
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Users className="h-3 w-3" /> {field.name}
      </label>
      <div className="flex flex-wrap gap-1">
        {people.map((p) => (
          <span key={personKey(p)} className={cn(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]',
            p.kind === 'user' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted text-foreground',
          )}>
            <User className="h-3 w-3" />
            <span className="max-w-[10ch] truncate">{p.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Folder Metadata Editor ───────────────────────────────────

export function FolderMetadataEditor({ folder }: { folder: FolderDto }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(folder.description ?? '');
  const [location, setLocation] = useState(folder.location ?? '');
  const [eventDate, setEventDate] = useState(folder.eventDate?.slice(0, 10) ?? '');

  useEffect(() => {
    setDescription(folder.description ?? '');
    setLocation(folder.location ?? '');
    setEventDate(folder.eventDate?.slice(0, 10) ?? '');
  }, [folder]);

  const mutation = useMutation({
    mutationFn: (data: Parameters<typeof foldersApi.update>[1]) => foldersApi.update(folder.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder', folder.id] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setEditing(false);
      toast.success('Saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Details</h4>
        {editing ? (
          <div className="flex gap-1">
            <button onClick={() => mutation.mutate({ description, location, eventDate: eventDate || null })}
              disabled={mutation.isPending}
              className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Save className="h-3 w-3" /> {mutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <EditField label="Description" value={description} onChange={setDescription} multiline />
          <EditField label="Location" value={location} onChange={setLocation} />
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Event Date</label>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-xs">
          {folder.description && <MetaField label="Description" value={folder.description} />}
          {folder.location && <MetaField label="Location" value={folder.location} />}
          {folder.eventDate && <MetaField label="Event Date" value={new Date(folder.eventDate).toLocaleDateString()} />}
        </div>
      )}

      <TagEditor entityType="FOLDER" entityId={folder.id} tags={folder.tags} />
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground w-20">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function ClickToEditField({ label, value, placeholder, onEdit }: {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  onEdit?: () => void;
}) {
  if (!onEdit) {
    // Read-only display
    if (!value) return null;
    return (
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
        <div className="px-2 py-1 text-xs text-foreground">{value}</div>
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <button
        onClick={onEdit}
        className={cn(
          'w-full rounded border border-transparent px-2 py-1 text-left text-xs transition-colors hover:border-input hover:bg-accent/50',
          value ? 'text-foreground' : 'text-muted-foreground/50 italic',
        )}
      >
        {value || placeholder || label}
      </button>
    </div>
  );
}

function EditField({ label, value, onChange, multiline, aiButton }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  aiButton?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
        {aiButton}
      </div>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
      )}
    </div>
  );
}

function RatingDisplay({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} className={cn('h-3.5 w-3.5', i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20')} />
      ))}
    </div>
  );
}

function RatingInput({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Rating</label>
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <button key={i} type="button" onClick={() => onChange(rating === i + 1 ? 0 : i + 1)} className="p-0.5"
            aria-label={`Rate ${i + 1}`}>
            <Star className={cn('h-4 w-4 transition-colors', i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30 hover:text-yellow-400/50')} />
          </button>
        ))}
        {rating > 0 && <button onClick={() => onChange(0)} className="ml-1 text-[10px] text-muted-foreground hover:text-foreground">Clear</button>}
      </div>
    </div>
  );
}
