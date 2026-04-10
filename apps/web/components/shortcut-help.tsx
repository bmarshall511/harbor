'use client';

import { useEffect, useState } from 'react';
import { X, Keyboard } from 'lucide-react';

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open search / command palette' },
      { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
      { keys: ['Esc'], description: 'Close panel / clear selection' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['V'], description: 'Toggle grid / list view' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Click'], description: 'Open file details' },
      { keys: ['⌘', 'Click'], description: 'Toggle file selection' },
    ],
  },
];

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-2xl animate-slide-in-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{s.description}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((key, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mx-0.5 text-[10px] text-muted-foreground">+</span>}
                          <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium">?</kbd> to toggle this panel
        </p>
      </div>
    </div>
  );
}
