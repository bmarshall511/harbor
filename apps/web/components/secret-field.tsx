'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * A masked secret input field that:
 * - Shows "Configured" or "Not configured" based on status
 * - Lets you set/update a secret value
 * - Never displays the actual secret after saving
 * - Can clear the secret
 */
export function SecretField({
  label,
  description,
  secretKey,
  isSet,
  helpUrl,
  helpText,
}: {
  label: string;
  description: string;
  secretKey: string;
  isSet: boolean;
  helpUrl?: string;
  helpText?: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [secretKey]: value }),
      });
      if (!res.ok) throw new Error('Failed to save');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets-status'] });
      setEditing(false);
      setValue('');
      toast.success(`${label} saved`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [secretKey]: null }),
      });
      if (!res.ok) throw new Error('Failed to clear');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets-status'] });
      toast.success(`${label} cleared`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {description}
            {helpUrl && (
              <>
                {' '}
                <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {helpText || 'Where to find this'}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSet && !editing && (
            <span className="flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
              <Check className="h-3 w-3" />
              Configured
            </span>
          )}
          {!isSet && !editing && (
            <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Not set
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isSet ? 'Enter new value to replace' : 'Enter value'}
              className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!value.trim() || saveMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setValue(''); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {isSet ? 'Update' : 'Configure'}
          </button>
          {isSet && (
            <button
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
