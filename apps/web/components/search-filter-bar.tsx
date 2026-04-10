'use client';

/**
 * Search filter bar — dynamic filter pills driven by admin-configured
 * MetadataFieldTemplates. Only fields with `showInSearch: true` appear.
 * Fields with `hiddenByDefault: true` (e.g. adult content) render as
 * collapsed/opt-in.
 *
 * Built-in filters (media type, date range, rating) are always shown
 * since they operate on first-class DB columns, not metadata fields.
 */

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import {
  Image,
  Video,
  FileAudio,
  FileText,
  Tags,
  Users,
  Star,
  Calendar,
  X,
  ChevronDown,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { tags as tagsApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchFilters {
  tags: string[];
  mimeTypes: string[];
  archiveRootIds: string[];
  ratingMin?: number;
  ratingMax?: number;
  dateFrom?: string;
  dateTo?: string;
  hasFaces?: boolean;
  /** Dynamic metadata field filters. Key = field template key, value = selected values. */
  metaFields: Record<string, string[]>;
}

interface MetaFieldTemplate {
  id: string;
  name: string;
  key: string;
  fieldType: string;
  options: Array<{ value: string; label: string }>;
  showInSearch: boolean;
  hiddenByDefault: boolean;
}

interface FilterBarProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  facets?: {
    tags?: Array<{ name: string; count: number }>;
    people?: Array<{ name: string; count: number }>;
    mimeTypes?: Array<{ value: string; count: number }>;
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SearchFilterBar({ filters, onFiltersChange, facets }: FilterBarProps) {
  const update = useCallback(
    (patch: Partial<SearchFilters>) => onFiltersChange({ ...filters, ...patch }),
    [filters, onFiltersChange],
  );

  const updateMetaField = useCallback(
    (key: string, values: string[]) => {
      onFiltersChange({
        ...filters,
        metaFields: { ...filters.metaFields, [key]: values },
      });
    },
    [filters, onFiltersChange],
  );

  // Load admin-configured search-enabled fields
  const { data: fieldTemplates } = useQuery<MetaFieldTemplate[]>({
    queryKey: ['metadata-fields'],
    queryFn: async () => {
      const res = await fetch('/api/metadata-fields');
      return res.json();
    },
  });

  const searchFields = (fieldTemplates ?? []).filter((f) => f.showInSearch);
  const visibleFields = searchFields.filter((f) => !f.hiddenByDefault);
  const hiddenFields = searchFields.filter((f) => f.hiddenByDefault);
  const [showHidden, setShowHidden] = useState(false);

  const activeCount =
    filters.tags.length +
    filters.mimeTypes.length +
    filters.archiveRootIds.length +
    (filters.ratingMin !== undefined ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.hasFaces ? 1 : 0) +
    Object.values(filters.metaFields).reduce((s, v) => s + v.length, 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* ── Built-in: Media type ───────────────────────────────── */}
      <MediaTypeFilter
        selected={filters.mimeTypes}
        onChange={(mimeTypes) => update({ mimeTypes })}
        facets={facets?.mimeTypes}
      />

      {/* ── Built-in: Tags ─────────────────────────────────────── */}
      <TagFilter selected={filters.tags} onChange={(tags) => update({ tags })} />

      {/* ── Built-in: Date range ───────────────────────────────── */}
      <DateFilter
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onChange={(dateFrom, dateTo) => update({ dateFrom, dateTo })}
      />

      {/* ── Dynamic metadata fields (showInSearch && !hiddenByDefault) */}
      {visibleFields.map((field) => (
        <DynamicMetaFilter
          key={field.id}
          field={field}
          selected={filters.metaFields[field.key] ?? []}
          onChange={(vals) => updateMetaField(field.key, vals)}
          facets={facets}
        />
      ))}

      {/* ── Hidden fields toggle (e.g. adult content) ──────────── */}
      {hiddenFields.length > 0 && (
        <>
          {!showHidden ? (
            <button
              type="button"
              onClick={() => setShowHidden(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            >
              <SlidersHorizontal className="h-3 w-3" />
              More filters
            </button>
          ) : (
            hiddenFields.map((field) => (
              <DynamicMetaFilter
                key={field.id}
                field={field}
                selected={filters.metaFields[field.key] ?? []}
                onChange={(vals) => updateMetaField(field.key, vals)}
                facets={facets}
              />
            ))
          )}
        </>
      )}

      {/* ── Clear all ──────────────────────────────────────────── */}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() =>
            onFiltersChange({
              tags: [],
              mimeTypes: [],
              archiveRootIds: [],
              ratingMin: undefined,
              ratingMax: undefined,
              dateFrom: undefined,
              dateTo: undefined,
              hasFaces: undefined,
              metaFields: {},
            })
          }
          className="ml-1 flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear all ({activeCount})
        </button>
      )}
    </div>
  );
}

// ─── Shared filter pill wrapper ───────────────────────────────────────────────

function FilterPill({
  icon: Icon,
  label,
  active,
  children,
}: {
  icon: typeof Tags;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition',
            active
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
          )}
        >
          <Icon className="h-3 w-3" />
          {label}
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Dynamic metadata field filter ────────────────────────────────────────────

function DynamicMetaFilter({
  field,
  selected,
  onChange,
  facets,
}: {
  field: MetaFieldTemplate;
  selected: string[];
  onChange: (vals: string[]) => void;
  facets?: FilterBarProps['facets'];
}) {
  const [q, setQ] = useState('');

  // Icon based on field type
  const icon =
    field.fieldType === 'people' ? Users
    : field.fieldType === 'multiselect' || field.fieldType === 'select' ? SlidersHorizontal
    : Tags;

  const activeLabel = selected.length
    ? `${field.name} (${selected.length})`
    : field.name;

  // For people fields, load suggestions from the people-suggestions API
  if (field.fieldType === 'people') {
    return (
      <PeopleMetaFilter
        field={field}
        selected={selected}
        onChange={onChange}
      />
    );
  }

  // For select/multiselect, use the field's configured options
  if (field.fieldType === 'select' || field.fieldType === 'multiselect') {
    const options = (field.options ?? []) as Array<{ value: string; label: string }>;
    const filtered = options.filter(
      (o) => !q || o.label.toLowerCase().includes(q.toLowerCase()),
    );

    const toggle = (v: string) => {
      onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
    };

    return (
      <FilterPill icon={icon} label={activeLabel} active={selected.length > 0}>
        {options.length > 5 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${field.name.toLowerCase()}…`}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {filtered.map((opt) => {
            const isOn = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition',
                  isOn ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                )}
              >
                <span className="flex-1 text-left">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </FilterPill>
    );
  }

  // For text/boolean fields, show a simple toggle or text input
  // (less common for search filters, but supported)
  return null;
}

// ─── People-specific filter with avatars ──────────────────────────────────────

function PeopleMetaFilter({
  field,
  selected,
  onChange,
}: {
  field: MetaFieldTemplate;
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const [q, setQ] = useState('');

  // Load both free-text people suggestions and registered persons
  const { data: suggestions } = useQuery({
    queryKey: ['people-suggestions', field.key],
    queryFn: async () => {
      const res = await fetch(`/api/people-suggestions?fieldKey=${field.key}`);
      return res.json() as Promise<string[]>;
    },
  });

  const { data: persons } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      return res.json() as Promise<Array<{
        id: string;
        name: string | null;
        avatarUrl: string | null;
        faceCount: number;
        linkedUser: { id: string; displayName: string } | null;
      }>>;
    },
  });

  // Merge both sources — persons (with avatars) take priority, then
  // free-text names not already covered by a person record.
  const personNames = new Set((persons ?? []).map((p) => p.name).filter(Boolean));
  const allPeople = [
    ...(persons ?? []).filter((p) => p.name).map((p) => ({
      name: p.name!,
      avatarUrl: p.avatarUrl,
      faceCount: p.faceCount,
      isPerson: true,
    })),
    ...(suggestions ?? [])
      .filter((name) => !personNames.has(name))
      .map((name) => ({
        name,
        avatarUrl: null as string | null,
        faceCount: 0,
        isPerson: false,
      })),
  ];

  const filtered = allPeople.filter(
    (p) => !q || p.name.toLowerCase().includes(q.toLowerCase()),
  );

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  return (
    <FilterPill
      icon={Users}
      label={selected.length ? `${field.name} (${selected.length})` : field.name}
      active={selected.length > 0}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people…"
        className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {filtered.slice(0, 40).map((person) => {
          const isOn = selected.includes(person.name);
          return (
            <button
              key={person.name}
              type="button"
              onClick={() => toggle(person.name)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition',
                isOn ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
              )}
            >
              {/* Avatar */}
              {person.avatarUrl ? (
                <img
                  src={person.avatarUrl}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="h-3 w-3" />
                </div>
              )}
              <span className="flex-1 text-left truncate">{person.name}</span>
              {person.faceCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{person.faceCount}</span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">No people found</p>
        )}
      </div>
    </FilterPill>
  );
}

// ─── Built-in filters ─────────────────────────────────────────────────────────

function MediaTypeFilter({
  selected,
  onChange,
  facets,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  facets?: Array<{ value: string; count: number }>;
}) {
  const types = [
    { value: 'image', label: 'Images', icon: Image },
    { value: 'video', label: 'Videos', icon: Video },
    { value: 'audio', label: 'Audio', icon: FileAudio },
    { value: 'text', label: 'Documents', icon: FileText },
  ];

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };

  return (
    <FilterPill icon={Image} label={selected.length ? `Type (${selected.length})` : 'Type'} active={selected.length > 0}>
      <div className="space-y-0.5">
        {types.map(({ value, label, icon: TypeIcon }) => {
          const isOn = selected.includes(value);
          const count = facets?.filter((f) => f.value.startsWith(value + '/')).reduce((s, f) => s + f.count, 0);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition',
                isOn ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
              )}
            >
              <TypeIcon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{label}</span>
              {count !== undefined && count > 0 && (
                <span className="text-[10px] text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </FilterPill>
  );
}

function TagFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
  });

  const filtered = (allTags ?? []).filter(
    (t) => !q || t.name.toLowerCase().includes(q.toLowerCase()),
  );

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  return (
    <FilterPill icon={Tags} label={selected.length ? `Tags (${selected.length})` : 'Tags'} active={selected.length > 0}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tags…"
        className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.slice(0, 30).map((tag) => {
          const isOn = selected.includes(tag.name);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.name)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition',
                isOn ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
              )}
            >
              {tag.color && (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
              )}
              <span className="flex-1 text-left truncate">{tag.name}</span>
              <span className="text-[10px] text-muted-foreground">{tag.usageCount}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">No tags found</p>
        )}
      </div>
    </FilterPill>
  );
}

function RatingFilter({
  min,
  max,
  onChange,
}: {
  min?: number;
  max?: number;
  onChange: (min?: number, max?: number) => void;
}) {
  const active = min !== undefined || max !== undefined;
  const label = active
    ? min === max ? `${min}★` : `${min ?? 1}–${max ?? 5}★`
    : 'Rating';

  return (
    <FilterPill icon={Star} label={label} active={active}>
      <p className="mb-2 text-[11px] text-muted-foreground">Minimum rating</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              if (min === n) onChange(undefined, undefined);
              else onChange(n, undefined);
            }}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-sm transition',
              min !== undefined && n >= min
                ? 'bg-amber-500/20 text-amber-600'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <Star className={cn('h-4 w-4', min !== undefined && n <= min && 'fill-current')} />
          </button>
        ))}
      </div>
      {min !== undefined && (
        <button
          type="button"
          onClick={() => onChange(undefined, undefined)}
          className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </FilterPill>
  );
}

function DateFilter({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom?: string;
  dateTo?: string;
  onChange: (from?: string, to?: string) => void;
}) {
  const active = !!(dateFrom || dateTo);
  const label = active
    ? dateFrom && dateTo
      ? `${dateFrom.slice(0, 10)} – ${dateTo.slice(0, 10)}`
      : dateFrom
        ? `From ${dateFrom.slice(0, 10)}`
        : `To ${dateTo!.slice(0, 10)}`
    : 'Date';

  return (
    <FilterPill icon={Calendar} label={label} active={active}>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={dateFrom?.slice(0, 10) ?? ''}
            onChange={(e) => onChange(e.target.value || undefined, dateTo)}
            className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={dateTo?.slice(0, 10) ?? ''}
            onChange={(e) => onChange(dateFrom, e.target.value || undefined)}
            className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {active && (
          <button
            type="button"
            onClick={() => onChange(undefined, undefined)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear dates
          </button>
        )}
      </div>
    </FilterPill>
  );
}
