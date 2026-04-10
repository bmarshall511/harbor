'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { relations as relationsApi, search } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Link2, Plus, Trash2, X, ArrowRight, Search, FileIcon, Folder } from 'lucide-react';
import { toast } from 'sonner';
import type { EntityRelationDto, RelationType, EntityType } from '@harbor/types';

const RELATION_LABELS: Record<RelationType, string> = {
  RELATED: 'Related',
  ALTERNATE_VERSION: 'Alternate Version',
  DERIVED_FROM: 'Derived From',
  DUPLICATE_CANDIDATE: 'Duplicate Candidate',
  SAME_EVENT: 'Same Event',
  SCAN_OF_SAME_SOURCE: 'Scan of Same Source',
  CURATED_ASSOCIATION: 'Curated Association',
};

const RELATION_TYPES: RelationType[] = [
  'RELATED',
  'ALTERNATE_VERSION',
  'DERIVED_FROM',
  'DUPLICATE_CANDIDATE',
  'SAME_EVENT',
  'SCAN_OF_SAME_SOURCE',
  'CURATED_ASSOCIATION',
];

export function RelationPanel({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: rels, isLoading } = useQuery({
    queryKey: ['relations', entityType, entityId],
    queryFn: () => relationsApi.listByEntity(entityType, entityId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => relationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', entityType, entityId] });
      toast.success('Relation removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          Relations
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {showCreate ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showCreate ? 'Cancel' : 'Add'}
        </button>
      </div>

      {showCreate && (
        <CreateRelationForm
          sourceType={entityType}
          sourceId={entityId}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['relations', entityType, entityId] });
          }}
        />
      )}

      {isLoading ? (
        <div className="space-y-1">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : rels && rels.length > 0 ? (
        <div className="space-y-1">
          {rels.map((rel) => (
            <RelationItem
              key={rel.id}
              relation={rel}
              currentEntityId={entityId}
              onDelete={() => deleteMutation.mutate(rel.id)}
              deleting={deleteMutation.isPending}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No relations yet.</p>
      )}
    </div>
  );
}

function RelationItem({
  relation,
  currentEntityId,
  onDelete,
  deleting,
}: {
  relation: EntityRelationDto;
  currentEntityId: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isSource = relation.sourceId === currentEntityId;
  const otherType = isSource ? relation.targetType : relation.sourceType;
  const otherId = isSource ? relation.targetId : relation.sourceId;

  return (
    <div className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
        {RELATION_LABELS[relation.relationType]}
      </span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="truncate text-muted-foreground">
        {otherType} {otherId.slice(0, 8)}...
      </span>
      {relation.confidence != null && (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {Math.round(relation.confidence * 100)}%
        </span>
      )}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="ml-auto hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover:block disabled:opacity-50"
        aria-label="Remove relation"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function CreateRelationForm({
  sourceType,
  sourceId,
  onCreated,
}: {
  sourceType: EntityType;
  sourceId: string;
  onCreated: () => void;
}) {
  const [relationType, setRelationType] = useState<RelationType>('RELATED');
  const [targetType, setTargetType] = useState<EntityType>('FILE');
  const [targetId, setTargetId] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      relationsApi.create({
        sourceType,
        sourceId,
        targetType,
        targetId,
        relationType,
        isBidirectional: true,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Relation created');
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <div>
        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Relation Type</label>
        <select
          value={relationType}
          onChange={(e) => setRelationType(e.target.value as RelationType)}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {RELATION_TYPES.map((t) => (
            <option key={t} value={t}>{RELATION_LABELS[t]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Find Target</label>
        <TargetPicker
          targetType={targetType}
          onTypeChange={setTargetType}
          targetId={targetId}
          onSelect={(type, id) => { setTargetType(type); setTargetId(id); }}
        />
      </div>

      <div>
        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Notes (optional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <button
        onClick={() => mutation.mutate()}
        disabled={!targetId || mutation.isPending}
        className="w-full rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {mutation.isPending ? 'Creating...' : 'Create Relation'}
      </button>
    </div>
  );
}

function TargetPicker({
  targetType,
  onTypeChange,
  targetId,
  onSelect,
}: {
  targetType: EntityType;
  onTypeChange: (t: EntityType) => void;
  targetId: string;
  onSelect: (type: EntityType, id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);

  const { data: results } = useQuery({
    queryKey: ['search', 'relation-picker', query],
    queryFn: () => search.query({ query, limit: 8 }),
    enabled: query.length >= 2,
  });

  const fileResults = results?.files ?? [];
  const folderResults = results?.folders ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onTypeChange('FILE')}
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            targetType === 'FILE' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          File
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('FOLDER')}
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            targetType === 'FOLDER' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          Folder
        </button>
      </div>

      <div className="relative">
        <div className="flex items-center gap-1.5 rounded border border-input bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={targetId ? `${targetId.slice(0, 8)}...` : query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(true);
              if (targetId) onSelect(targetType, '');
            }}
            onFocus={() => { if (targetId) { setQuery(''); onSelect(targetType, ''); } setShowResults(true); }}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="Search by name..."
            className="flex-1 bg-transparent text-xs focus:outline-none"
          />
          {targetId && (
            <button onClick={() => { onSelect(targetType, ''); setQuery(''); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {showResults && query.length >= 2 && (fileResults.length > 0 || folderResults.length > 0) && (
          <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border border-border bg-popover py-1 shadow-lg">
            {fileResults.map((f) => (
              <button
                key={f.id}
                onMouseDown={(e) => { e.preventDefault(); onSelect('FILE', f.id); setQuery(f.name); setShowResults(false); }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                <FileIcon className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{f.title ?? f.name}</span>
              </button>
            ))}
            {folderResults.map((f) => (
              <button
                key={f.id}
                onMouseDown={(e) => { e.preventDefault(); onSelect('FOLDER', f.id); setQuery(f.name); setShowResults(false); }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                <Folder className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {targetId && (
        <p className="text-[10px] text-muted-foreground">
          Selected: {targetType.toLowerCase()} {targetId.slice(0, 12)}...
        </p>
      )}
    </div>
  );
}
