'use client';

/**
 * AiSuggestButton — triggers AI content generation for an image file.
 *
 * Opens a dialog with: confirm step (cost/time estimates from actual
 * past runs, tone selector) → loading → results (titles, description,
 * tags) → pick a title to apply all content.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, Loader2, AlertTriangle, RefreshCw, X, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

const TONE_OPTIONS = [
  { value: '', label: 'Default (from settings)', group: '' },
  { value: 'descriptive', label: 'Descriptive', group: 'Standard' },
  { value: 'professional', label: 'Professional', group: 'Standard' },
  { value: 'casual', label: 'Casual', group: 'Standard' },
  { value: 'minimal', label: 'Minimal', group: 'Standard' },
  { value: 'technical', label: 'Technical', group: 'Standard' },
  { value: 'journalistic', label: 'Journalistic', group: 'Standard' },
  { value: 'creative', label: 'Creative', group: 'Creative' },
  { value: 'poetic', label: 'Poetic', group: 'Creative' },
  { value: 'dramatic', label: 'Dramatic', group: 'Creative' },
  { value: 'nostalgic', label: 'Nostalgic', group: 'Creative' },
  { value: 'cinematic', label: 'Cinematic', group: 'Creative' },
  { value: 'whimsical', label: 'Whimsical', group: 'Creative' },
  { value: 'mysterious', label: 'Mysterious', group: 'Creative' },
  { value: 'romantic', label: 'Romantic', group: 'Creative' },
  { value: 'humorous', label: 'Humorous', group: 'Fun' },
  { value: 'sarcastic', label: 'Sarcastic', group: 'Fun' },
  { value: 'clickbait', label: 'Clickbait', group: 'Fun' },
  { value: 'roast', label: 'Roast', group: 'Fun' },
  { value: 'meme', label: 'Meme-style', group: 'Fun' },
  { value: 'deadpan', label: 'Deadpan', group: 'Fun' },
  { value: 'sensual', label: 'Sensual', group: 'Intimate' },
  { value: 'alluring', label: 'Alluring', group: 'Intimate' },
  { value: 'intimate', label: 'Intimate', group: 'Intimate' },
  { value: 'bold-artistic', label: 'Bold Artistic', group: 'Intimate' },
  { value: 'provocative', label: 'Provocative', group: 'Intimate' },
  { value: 'seductive', label: 'Seductive', group: 'Intimate' },
  { value: 'risque', label: 'Risqué', group: 'Intimate' },
  { value: 'boudoir', label: 'Boudoir', group: 'Intimate' },
  { value: 'dark', label: 'Dark', group: 'Mood' },
  { value: 'uplifting', label: 'Uplifting', group: 'Mood' },
  { value: 'melancholic', label: 'Melancholic', group: 'Mood' },
  { value: 'ethereal', label: 'Ethereal', group: 'Mood' },
  { value: 'edgy', label: 'Edgy', group: 'Mood' },
  { value: 'serene', label: 'Serene', group: 'Mood' },
];

interface SuggestResponse {
  suggestions: string[];
  descriptions: string[];
  tags: string[];
  jobId: string;
  tokens: { input: number; output: number };
  cost: number;
  model: string;
  provider: string;
}

interface AiSuggestButtonProps {
  fileId: string;
  onSelectTitle: (value: string) => void;
  onSelectDescription?: (value: string) => void;
  onSelectTags?: (tags: string[]) => void;
  enabled?: boolean;
}

export function AiSuggestButton({ fileId, onSelectTitle, onSelectDescription, onSelectTags, enabled = true }: AiSuggestButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toneOverride, setToneOverride] = useState('');
  const [selectedDesc, setSelectedDesc] = useState<number>(-1);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Fetch actual cost/time from past AI jobs for the estimate
  const { data: usageStats } = useQuery({
    queryKey: ['ai-usage-estimate'],
    queryFn: async () => {
      const res = await fetch('/api/admin/ai-usage');
      if (!res.ok) return null;
      const data = await res.json();
      const titleJobs = (data.recent ?? []).filter((j: any) => j.purpose === 'title_generation' && j.cost > 0);
      if (titleJobs.length === 0) return null;
      const avgCost = titleJobs.reduce((s: number, j: any) => s + (j.cost ?? 0), 0) / titleJobs.length;
      const avgTime = titleJobs.reduce((s: number, j: any) => s + (j.elapsedMs ?? 0), 0) / titleJobs.length;
      const lastModel = titleJobs[0]?.model ?? null;
      return { avgCost, avgTime, count: titleJobs.length, model: lastModel };
    },
    staleTime: 60_000,
    enabled: open,
  });

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch('/api/ai/suggest-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, ...(toneOverride ? { tone: toneOverride } : {}) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `Request failed (${res.status})` }));
        throw new Error(err.message || `Request failed (${res.status})`);
      }

      const result = await res.json() as SuggestResponse;
      setData(result);
      // Auto-select all tags and first description
      setSelectedTags(new Set(result.tags));
      setSelectedDesc(result.descriptions.length > 0 ? 0 : -1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (title: string) => {
    onSelectTitle(title);
    // Apply the selected description (if any)
    if (selectedDesc >= 0 && data?.descriptions[selectedDesc] && onSelectDescription) {
      onSelectDescription(data.descriptions[selectedDesc]);
    }
    // Apply only the checked tags
    if (selectedTags.size > 0 && onSelectTags) {
      onSelectTags([...selectedTags]);
    }
    setOpen(false);
  };

  const handleClose = () => {
    setOpen(false);
    setData(null);
    setError(null);
    setToneOverride('');
  };

  if (!enabled) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => o ? setOpen(true) : handleClose()}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
            'border-primary/30 text-primary hover:bg-primary/10',
          )}
          title="AI content suggestions"
        >
          <Sparkles className="h-3 w-3" />
          <span>AI</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in-0 zoom-in-95">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <Dialog.Title className="text-sm font-semibold">AI Content Generation</Dialog.Title>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {/* Confirm step */}
            {!loading && !data && !error && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  AI will analyze this image and generate title suggestions, a description, and tags in a single request.
                </p>

                {/* Tone selector */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-muted-foreground shrink-0">Tone:</label>
                  <select
                    value={toneOverride}
                    onChange={(e) => setToneOverride(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Default (from settings)</option>
                    {(() => {
                      const groups = [...new Set(TONE_OPTIONS.filter((t) => t.group).map((t) => t.group))];
                      return groups.map((group) => (
                        <optgroup key={group} label={group}>
                          {TONE_OPTIONS.filter((t) => t.group === group).map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                </div>

                {/* Cost/time estimate from actuals */}
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground space-y-1">
                  {usageStats ? (
                    <>
                      <p>Model: <span className="font-medium text-foreground">{usageStats.model ?? 'Default from settings'}</span></p>
                      <p>Avg cost: <span className="font-medium text-foreground">${usageStats.avgCost.toFixed(4)}</span> per image <span className="text-muted-foreground/60">(based on {usageStats.count} past runs)</span></p>
                      <p>Avg time: <span className="font-medium text-foreground">{(usageStats.avgTime / 1000).toFixed(1)}s</span></p>
                    </>
                  ) : (
                    <>
                      <p>Estimated cost: ~$0.005–0.02 per image</p>
                      <p>Estimated time: 3–8 seconds</p>
                      <p className="text-muted-foreground/60 italic">Estimates will be based on actual runs after your first request.</p>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={fetchSuggestions}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate
                </button>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analyzing image...</p>
              </div>
            )}

            {/* Error — show details + tone selector for retry */}
            {error && !loading && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                </div>

                {/* Tone selector — let user change before retrying */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-muted-foreground shrink-0">Tone:</label>
                  <select
                    value={toneOverride}
                    onChange={(e) => setToneOverride(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Default (from settings)</option>
                    {(() => {
                      const groups = [...new Set(TONE_OPTIONS.filter((t) => t.group).map((t) => t.group))];
                      return groups.map((group) => (
                        <optgroup key={group} label={group}>
                          {TONE_OPTIONS.filter((t) => t.group === group).map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={fetchSuggestions}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              </div>
            )}

            {/* Results */}
            {data && !loading && (
              <div className="space-y-4">
                {/* Title suggestions */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Titles — click to select</p>
                  <div className="space-y-1">
                    {data.suggestions.map((title, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelect(title)}
                        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:border-primary/30 hover:bg-primary/5"
                      >
                        <span className="flex-1">{title}</span>
                        <Check className="h-3.5 w-3.5 text-muted-foreground/30" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Descriptions — click to select */}
                {data.descriptions.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Description — pick one</p>
                    <div className="space-y-1">
                      {data.descriptions.map((desc, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSelectedDesc(i)}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs leading-relaxed transition',
                            selectedDesc === i
                              ? 'border-primary/40 bg-primary/5 text-foreground'
                              : 'border-border text-muted-foreground hover:border-primary/20',
                          )}
                        >
                          <div className={cn(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition',
                            selectedDesc === i ? 'border-primary bg-primary' : 'border-border',
                          )}>
                            {selectedDesc === i && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </div>
                          <span>{desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags — individually selectable */}
                {data.tags.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tags</p>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedTags.size === data.tags.length) setSelectedTags(new Set());
                          else setSelectedTags(new Set(data.tags));
                        }}
                        className="text-[10px] text-primary hover:underline"
                      >
                        {selectedTags.size === data.tags.length ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.tags.map((tag, i) => {
                        const isOn = selectedTags.has(tag);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              const next = new Set(selectedTags);
                              if (isOn) next.delete(tag); else next.add(tag);
                              setSelectedTags(next);
                            }}
                            className={cn(
                              'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                              isOn
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/20',
                            )}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground/60 italic">
                  Pick a title above to apply it along with the selected description and tags.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {data && !loading && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                ${data.cost.toFixed(4)} · {data.tokens.input + data.tokens.output} tokens · {data.model}
              </span>
              <button
                type="button"
                onClick={fetchSuggestions}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
