'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertTriangle,
  User,
  PawPrint,
  Users,
  Heart,
  Baby,
  UserPlus,
  Loader2,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────

interface PersonOption {
  id: string;
  name: string | null;
  entityType: string;
  avatarUrl: string | null;
  gender: string | null;
}

interface InferredRelationship {
  sourcePersonId: string;
  sourceName: string;
  targetPersonId: string;
  targetName: string;
  relationType: string;
  alreadyExists: boolean;
  inferred: boolean;
}

interface SuggestedGroup {
  groupId: string;
  groupName: string;
  groupColor: string | null;
}

type Role = 'child' | 'spouse' | 'sibling' | 'parent' | 'pet' | 'friend';

const ROLE_OPTIONS: Array<{
  value: Role;
  label: string;
  icon: typeof User;
  description: string;
  forEntity: 'PERSON' | 'PET' | 'both';
}> = [
  { value: 'child', label: 'Child', icon: Baby, description: 'Son, daughter — select their parents', forEntity: 'PERSON' },
  { value: 'sibling', label: 'Sibling', icon: Users, description: 'Brother, sister — select a sibling', forEntity: 'PERSON' },
  { value: 'spouse', label: 'Spouse / Partner', icon: Heart, description: 'Married or life partner', forEntity: 'PERSON' },
  { value: 'parent', label: 'Parent', icon: User, description: 'Mother, father — select their children', forEntity: 'PERSON' },
  { value: 'pet', label: 'Pet', icon: PawPrint, description: 'Family pet — select their owners', forEntity: 'PET' },
  { value: 'friend', label: 'Friend', icon: UserPlus, description: 'No family inference', forEntity: 'both' },
];

const REL_TYPE_LABELS: Record<string, string> = {
  parent: 'Parent',
  child: 'Child',
  sibling: 'Sibling',
  spouse: 'Spouse',
  partner: 'Partner',
  grandparent: 'Grandparent',
  grandchild: 'Grandchild',
  'aunt/uncle': 'Aunt/Uncle',
  'niece/nephew': 'Niece/Nephew',
  cousin: 'Cousin',
  friend: 'Friend',
  colleague: 'Colleague',
  owner: 'Owner',
  pet_of: 'Pet Of',
};

// ─── Main Component ───────────────────────────────────────────

interface AddPersonWizardProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select an existing person to add relationships for */
  existingPersonId?: string;
}

export function AddPersonWizard({ open, onClose, existingPersonId }: AddPersonWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  // Step 0: Person identity
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState<'PERSON' | 'PET'>('PERSON');
  const [gender, setGender] = useState<string>('');
  const [useExisting, setUseExisting] = useState<string | null>(existingPersonId ?? null);
  const [createdPersonId, setCreatedPersonId] = useState<string | null>(null);

  // Step 1: Role
  const [role, setRole] = useState<Role | null>(null);
  const [relatedToIds, setRelatedToIds] = useState<string[]>([]);

  // Step 2: Review
  const [inferredRels, setInferredRels] = useState<InferredRelationship[]>([]);
  const [suggestedGroups, setSuggestedGroups] = useState<SuggestedGroup[]>([]);
  const [selectedRels, setSelectedRels] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const personId = useExisting ?? createdPersonId;

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setStep(existingPersonId ? 1 : 0);
      setName('');
      setEntityType('PERSON');
      setGender('');
      setUseExisting(existingPersonId ?? null);
      setCreatedPersonId(null);
      setRole(null);
      setRelatedToIds([]);
      setInferredRels([]);
      setSuggestedGroups([]);
      setSelectedRels(new Set());
      setSelectedGroups(new Set());
    }
  }, [open, existingPersonId]);

  // Fetch all people for pickers
  const { data: allPersons = [] } = useQuery<PersonOption[]>({
    queryKey: ['persons'],
    queryFn: async () => {
      const r = await fetch('/api/persons');
      if (!r.ok) return [];
      return (await r.json()).filter((p: any) => p.source === 'record');
    },
    enabled: open,
  });

  // Duplicate check
  const { data: duplicates } = useQuery({
    queryKey: ['person-duplicate-check', name],
    queryFn: async () => {
      const r = await fetch(`/api/persons/check-duplicate?name=${encodeURIComponent(name)}`);
      if (!r.ok) return { matches: [] };
      return r.json() as Promise<{ matches: Array<PersonOption & { exactMatch: boolean }> }>;
    },
    enabled: open && name.trim().length >= 2 && !useExisting,
    staleTime: 5_000,
  });

  // Create person
  const createPerson = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          entityType,
          ...(gender ? { gender } : {}),
        }),
      });
      if (!r.ok) throw new Error('Failed to create person');
      return r.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      setCreatedPersonId(data.id);
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      setStep(1);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Infer relationships
  const inferMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/person-relationships/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId,
          role: role === 'spouse' ? 'spouse' : role,
          relatedToIds,
        }),
      });
      if (!r.ok) throw new Error('Failed to compute relationships');
      return r.json() as Promise<{
        relationships: InferredRelationship[];
        suggestedGroups: SuggestedGroup[];
      }>;
    },
    onSuccess: (data) => {
      setInferredRels(data.relationships);
      setSuggestedGroups(data.suggestedGroups);
      // Pre-select all non-existing relationships
      const newRels = new Set(
        data.relationships
          .filter((r) => !r.alreadyExists)
          .map((r) => `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`),
      );
      setSelectedRels(newRels);
      setSelectedGroups(new Set(data.suggestedGroups.map((g) => g.groupId)));
      setStep(2);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk create
  const bulkCreate = useMutation({
    mutationFn: async () => {
      const relationships = inferredRels
        .filter((r) => selectedRels.has(`${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`))
        .map((r) => ({
          sourcePersonId: r.sourcePersonId,
          targetPersonId: r.targetPersonId,
          relationType: r.relationType,
        }));
      const groupMemberships = suggestedGroups
        .filter((g) => selectedGroups.has(g.groupId))
        .map((g) => ({ groupId: g.groupId, personId: personId! }));

      const r = await fetch('/api/person-relationships/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationships, groupMemberships }),
      });
      if (!r.ok) throw new Error('Failed to create relationships');
      return r.json() as Promise<{ created: number; skipped: number; groupsAdded: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['person-relationships'] });
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      toast.success(
        `Created ${data.created} relationship${data.created !== 1 ? 's' : ''}${data.groupsAdded > 0 ? ` and added to ${data.groupsAdded} group${data.groupsAdded !== 1 ? 's' : ''}` : ''}${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`,
      );
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Step navigation
  const handleStep0Next = useCallback(() => {
    if (useExisting) {
      setStep(1);
    } else if (name.trim()) {
      createPerson.mutate();
    }
  }, [useExisting, name, createPerson]);

  const handleStep1Next = useCallback(() => {
    if (!role || relatedToIds.length === 0 || !personId) return;
    inferMutation.mutate();
  }, [role, relatedToIds, personId, inferMutation]);

  const handleStep2Confirm = useCallback(() => {
    bulkCreate.mutate();
  }, [bulkCreate]);

  if (!open) return null;

  const steps = [
    { label: 'Person', done: step > 0 },
    { label: 'Role', done: step > 1 },
    { label: 'Review', done: false },
  ];

  const newRelsCount = inferredRels.filter(
    (r) => !r.alreadyExists && selectedRels.has(`${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`),
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Add Person</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-border/50 bg-muted/20">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  i === step
                    ? 'bg-primary text-primary-foreground'
                    : s.done
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'text-muted-foreground',
                )}
              >
                {s.done ? <Check className="h-3 w-3" /> : <span className="text-[10px]">{i + 1}</span>}
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-[320px] max-h-[60vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <StepMotion key="step0">
                <Step0Identity
                  name={name}
                  setName={setName}
                  entityType={entityType}
                  setEntityType={setEntityType}
                  gender={gender}
                  setGender={setGender}
                  duplicates={duplicates?.matches ?? []}
                  useExisting={useExisting}
                  setUseExisting={setUseExisting}
                  allPersons={allPersons}
                />
              </StepMotion>
            )}
            {step === 1 && (
              <StepMotion key="step1">
                <Step1Role
                  entityType={entityType}
                  role={role}
                  setRole={setRole}
                  relatedToIds={relatedToIds}
                  setRelatedToIds={setRelatedToIds}
                  allPersons={allPersons.filter((p) => p.id !== personId)}
                  personName={useExisting ? allPersons.find((p) => p.id === useExisting)?.name ?? name : name}
                />
              </StepMotion>
            )}
            {step === 2 && (
              <StepMotion key="step2">
                <Step2Review
                  relationships={inferredRels}
                  suggestedGroups={suggestedGroups}
                  selectedRels={selectedRels}
                  setSelectedRels={setSelectedRels}
                  selectedGroups={selectedGroups}
                  setSelectedGroups={setSelectedGroups}
                />
              </StepMotion>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step === 0 && (
            <button
              onClick={handleStep0Next}
              disabled={!useExisting && (!name.trim() || createPerson.isPending)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createPerson.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}

          {step === 1 && (
            <button
              onClick={handleStep1Next}
              disabled={!role || relatedToIds.length === 0 || inferMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {inferMutation.isPending ? (
                <>
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  Computing...
                </>
              ) : (
                <>
                  Compute Relationships
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}

          {step === 2 && (
            <button
              onClick={handleStep2Confirm}
              disabled={newRelsCount === 0 || bulkCreate.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {bulkCreate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Create {newRelsCount} Relationship{newRelsCount !== 1 ? 's' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step Animation Wrapper ───────────────────────────────────

function StepMotion({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.15 }}
      className="p-5"
    >
      {children}
    </motion.div>
  );
}

// ─── Step 0: Identity ─────────────────────────────────────────

function Step0Identity({
  name, setName, entityType, setEntityType, gender, setGender,
  duplicates, useExisting, setUseExisting, allPersons,
}: {
  name: string;
  setName: (v: string) => void;
  entityType: 'PERSON' | 'PET';
  setEntityType: (v: 'PERSON' | 'PET') => void;
  gender: string;
  setGender: (v: string) => void;
  duplicates: Array<PersonOption & { exactMatch: boolean }>;
  useExisting: string | null;
  setUseExisting: (v: string | null) => void;
  allPersons: PersonOption[];
}) {
  if (useExisting) {
    const person = allPersons.find((p) => p.id === useExisting);
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Adding relationships for an existing person:</p>
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <PersonAvatar person={person} size="md" />
          <div>
            <p className="text-sm font-medium">{person?.name ?? 'Unknown'}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{person?.entityType?.toLowerCase()}</p>
          </div>
          <button
            onClick={() => setUseExisting(null)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Entity type toggle */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(['PERSON', 'PET'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setEntityType(t)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                entityType === t
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'PET' ? <PawPrint className="h-3 w-3" /> : <User className="h-3 w-3" />}
              {t === 'PET' ? 'Pet' : 'Person'}
            </button>
          ))}
        </div>
      </div>

      {/* Name input */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={entityType === 'PET' ? 'e.g. Spock' : 'e.g. John Smith'}
          autoFocus
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Gender (persons only) */}
      {entityType === 'PERSON' && (
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Gender</label>
          <div className="flex gap-1">
            {[
              { value: '', label: 'Not set' },
              { value: 'MALE', label: 'Male' },
              { value: 'FEMALE', label: 'Female' },
              { value: 'OTHER', label: 'Other' },
            ].map((g) => (
              <button
                key={g.value}
                onClick={() => setGender(g.value)}
                className={cn(
                  'flex-1 rounded-md border py-1 text-xs font-medium transition-colors',
                  gender === g.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Similar {duplicates.length === 1 ? 'person' : 'people'} found
          </div>
          <div className="mt-2 space-y-1.5">
            {duplicates.map((d) => (
              <button
                key={d.id}
                onClick={() => setUseExisting(d.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs hover:border-primary/30 transition-colors"
              >
                <PersonAvatar person={d} size="sm" />
                <span className="font-medium">{d.name}</span>
                {d.exactMatch && (
                  <span className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">Exact match</span>
                )}
                <span className="text-muted-foreground">Use this</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Role + Related People ────────────────────────────

function Step1Role({
  entityType, role, setRole, relatedToIds, setRelatedToIds, allPersons, personName,
}: {
  entityType: 'PERSON' | 'PET';
  role: Role | null;
  setRole: (v: Role) => void;
  relatedToIds: string[];
  setRelatedToIds: (v: string[]) => void;
  allPersons: PersonOption[];
  personName: string;
}) {
  const applicableRoles = ROLE_OPTIONS.filter(
    (r) => r.forEntity === 'both' || r.forEntity === entityType,
  );

  const pickerLabel = useMemo(() => {
    switch (role) {
      case 'child': return `Who are ${personName}'s parents?`;
      case 'sibling': return `Who is ${personName} a sibling of?`;
      case 'spouse': return `Who is ${personName}'s spouse/partner?`;
      case 'parent': return `Who are ${personName}'s children?`;
      case 'pet': return `Who owns ${personName}?`;
      case 'friend': return `Who is ${personName} friends with?`;
      default: return 'Select related people';
    }
  }, [role, personName]);

  return (
    <div className="space-y-4">
      {/* Role cards */}
      <div>
        <label className="mb-2 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {personName} is a...
        </label>
        <div className="grid grid-cols-2 gap-2">
          {applicableRoles.map((r) => {
            const Icon = r.icon;
            const isSelected = role === r.value;
            return (
              <button
                key={r.value}
                onClick={() => { setRole(r.value); setRelatedToIds([]); }}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/30',
                )}
              >
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                <div>
                  <p className={cn('text-xs font-medium', isSelected ? 'text-primary' : 'text-foreground')}>{r.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{r.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Person picker */}
      {role && (
        <div>
          <label className="mb-2 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {pickerLabel}
          </label>
          <PersonMultiPicker
            persons={allPersons}
            selected={relatedToIds}
            onChange={setRelatedToIds}
            max={role === 'child' ? 2 : role === 'spouse' ? 1 : undefined}
          />
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Review ───────────────────────────────────────────

function Step2Review({
  relationships, suggestedGroups, selectedRels, setSelectedRels, selectedGroups, setSelectedGroups,
}: {
  relationships: InferredRelationship[];
  suggestedGroups: SuggestedGroup[];
  selectedRels: Set<string>;
  setSelectedRels: (v: Set<string>) => void;
  selectedGroups: Set<string>;
  setSelectedGroups: (v: Set<string>) => void;
}) {
  const newRels = relationships.filter((r) => !r.alreadyExists);
  const existingRels = relationships.filter((r) => r.alreadyExists);

  const toggleRel = (r: InferredRelationship) => {
    const key = `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`;
    const next = new Set(selectedRels);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedRels(next);
  };

  const toggleGroup = (groupId: string) => {
    const next = new Set(selectedGroups);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setSelectedGroups(next);
  };

  const selectAll = () => {
    setSelectedRels(new Set(newRels.map((r) => `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`)));
  };
  const selectNone = () => setSelectedRels(new Set());

  return (
    <div className="space-y-4">
      {/* New relationships */}
      {newRels.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {newRels.length} New Relationship{newRels.length !== 1 ? 's' : ''}
            </label>
            <div className="flex gap-2 text-[10px]">
              <button onClick={selectAll} className="text-primary hover:underline">Select all</button>
              <button onClick={selectNone} className="text-muted-foreground hover:underline">None</button>
            </div>
          </div>
          <div className="space-y-1">
            {newRels.map((r) => {
              const key = `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`;
              const checked = selectedRels.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleRel(r)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    checked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border bg-card opacity-50',
                  )}
                >
                  <div className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    checked ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  <span className="text-xs font-medium truncate">{r.sourceName}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {REL_TYPE_LABELS[r.relationType] ?? r.relationType}
                  </span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                  <span className="text-xs font-medium truncate">{r.targetName}</span>
                  {r.inferred && (
                    <Sparkles className="h-3 w-3 shrink-0 text-amber-500 ml-auto" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Already existing */}
      {existingRels.length > 0 && (
        <div>
          <label className="mb-2 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {existingRels.length} Already Exist (skipped)
          </label>
          <div className="space-y-1">
            {existingRels.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 opacity-40">
                <Check className="h-3 w-3 text-green-500 shrink-0" />
                <span className="text-[11px] truncate">{r.sourceName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{REL_TYPE_LABELS[r.relationType] ?? r.relationType}</span>
                <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/30" />
                <span className="text-[11px] truncate">{r.targetName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group suggestions */}
      {suggestedGroups.length > 0 && (
        <div>
          <label className="mb-2 block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Add to Groups
          </label>
          <div className="space-y-1">
            {suggestedGroups.map((g) => {
              const checked = selectedGroups.has(g.groupId);
              return (
                <button
                  key={g.groupId}
                  onClick={() => toggleGroup(g.groupId)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    checked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border bg-card opacity-50',
                  )}
                >
                  <div className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    checked ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  {g.groupColor && (
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: g.groupColor }} />
                  )}
                  <span className="text-xs font-medium">{g.groupName}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {newRels.length === 0 && existingRels.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No relationships to create. All connections already exist.
        </div>
      )}
    </div>
  );
}

// ─── Person Multi-Picker ──────────────────────────────────────

function PersonMultiPicker({
  persons, selected, onChange, max,
}: {
  persons: PersonOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return persons.filter((p) => p.name?.toLowerCase().includes(q));
  }, [persons, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (!max || selected.length < max) {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const p = persons.find((pp) => pp.id === id);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
              >
                <PersonAvatar person={p} size="xs" />
                {p?.name ?? 'Unknown'}
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search people..."
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* List */}
      <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-lg border border-border p-1">
        {filtered.length === 0 && (
          <p className="p-2 text-center text-[11px] text-muted-foreground">No people found</p>
        )}
        {filtered.slice(0, 30).map((p) => {
          const isSelected = selected.includes(p.id);
          const isPet = p.entityType === 'PET';
          const atMax = max && selected.length >= max && !isSelected;
          return (
            <button
              key={p.id}
              onClick={() => !atMax && toggle(p.id)}
              disabled={!!atMax}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                isSelected
                  ? 'bg-primary/10 text-primary'
                  : atMax
                    ? 'opacity-30 cursor-not-allowed'
                    : 'hover:bg-accent',
              )}
            >
              <PersonAvatar person={p} size="sm" />
              <span className="font-medium truncate">{p.name ?? 'Unknown'}</span>
              {isPet && <PawPrint className="h-3 w-3 text-amber-500 ml-auto" />}
              {isSelected && <Check className="h-3 w-3 text-primary ml-auto" />}
            </button>
          );
        })}
      </div>
      {max && (
        <p className="text-[10px] text-muted-foreground">
          Select up to {max} {max === 1 ? 'person' : 'people'}
        </p>
      )}
    </div>
  );
}

// ─── Person Avatar ────────────────────────────────────────────

function PersonAvatar({ person, size = 'md' }: { person?: PersonOption | null; size?: 'xs' | 'sm' | 'md' }) {
  const sizeClasses = {
    xs: 'h-4 w-4',
    sm: 'h-6 w-6',
    md: 'h-9 w-9',
  };
  const isPet = person?.entityType === 'PET';

  return (
    <div className={cn(
      sizeClasses[size],
      'flex items-center justify-center overflow-hidden shrink-0',
      isPet ? 'rounded-lg' : 'rounded-full',
      'bg-muted border border-border/50',
    )}>
      {person?.avatarUrl ? (
        <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : isPet ? (
        <PawPrint className={cn(size === 'xs' ? 'h-2 w-2' : size === 'sm' ? 'h-3 w-3' : 'h-4 w-4', 'text-amber-500')} />
      ) : (
        <User className={cn(size === 'xs' ? 'h-2 w-2' : size === 'sm' ? 'h-3 w-3' : 'h-4 w-4', 'text-muted-foreground')} />
      )}
    </div>
  );
}
