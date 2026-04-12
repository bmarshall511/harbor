'use client';

/**
 * AiSuggestButton — sparkle icon button that triggers AI content
 * generation and shows results in a popover.
 *
 * Designed to sit next to form fields (title, description, tags).
 * Reusable across different AI suggestion types.
 *
 * States: idle → loading → results (or error)
 */

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Sparkles, Loader2, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AiSuggestButtonProps {
  /** The file ID to analyze. */
  fileId: string;
  /** Which field is being suggested. */
  field: 'title' | 'description' | 'tags';
  /** Called when the user picks a suggestion. */
  onSelect: (value: string) => void;
  /** Whether AI features are enabled (hides the button if false). */
  enabled?: boolean;
}

interface SuggestResponse {
  suggestions: string[];
  jobId: string;
  tokens: { input: number; output: number };
  cost: number;
  model: string;
  provider: string;
}

const ENDPOINT_MAP: Record<string, string> = {
  title: '/api/ai/suggest-title',
  description: '/api/ai/suggest-description',
  tags: '/api/ai/suggest-tags',
};

export function AiSuggestButton({ fileId, field, onSelect, enabled = true }: AiSuggestButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(ENDPOINT_MAP[field], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `Request failed (${res.status})` }));
        throw new Error(err.message || `Request failed (${res.status})`);
      }

      const result = await res.json() as SuggestResponse;
      if (!result.suggestions?.length) {
        throw new Error('No suggestions returned. Try again.');
      }
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && !data && !loading) {
      fetchSuggestions();
    }
  };

  const handleSelect = (value: string) => {
    onSelect(value);
    setOpen(false);
  };

  if (!enabled) return null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center justify-center rounded-md p-1 transition-colors',
            'text-muted-foreground hover:text-primary hover:bg-primary/10',
            open && 'text-primary bg-primary/10',
          )}
          title={`Suggest ${field} with AI`}
          aria-label={`AI ${field} suggestions`}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold">AI {field} suggestions</span>
            </div>
            <Popover.Close className="rounded-md p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </Popover.Close>
          </div>

          {/* Content */}
          <div className="p-2">
            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center gap-2 py-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Analyzing image...</p>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="space-y-2 py-2">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-xs text-destructive break-words">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={fetchSuggestions}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition"
                >
                  <RefreshCw className="h-3 w-3" />
                  Try again
                </button>
              </div>
            )}

            {/* Results */}
            {data && !loading && (
              <div className="space-y-1">
                {data.suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelect(suggestion)}
                    className="flex w-full items-start rounded-lg px-3 py-2 text-left text-xs transition hover:bg-accent"
                  >
                    <span className="leading-relaxed">{suggestion}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {data && !loading && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                ~${data.cost.toFixed(4)} · {data.tokens.input + data.tokens.output} tokens · {data.model}
              </span>
              <button
                type="button"
                onClick={fetchSuggestions}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 transition"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                Regenerate
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
