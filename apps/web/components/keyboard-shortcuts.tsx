'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

export function KeyboardShortcutHandler() {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const closeDetailPanel = useAppStore((s) => s.closeDetailPanel);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const viewMode = useAppStore((s) => s.viewMode);
  const clearSelection = useAppStore((s) => s.clearSelection);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // When the viewer is open, it handles its own keyboard events.
      // Do NOT process any shortcuts here to avoid conflicts.
      if (useAppStore.getState().viewerFileId !== null) return;

      // Command palette: Cmd+K
      if (meta && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (isInput) return;

      // Toggle sidebar: Cmd+B
      if (meta && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Close detail panel: Escape
      if (e.key === 'Escape') {
        closeDetailPanel();
        clearSelection();
        return;
      }

      // Toggle view mode: V
      if (e.key === 'v' && !meta) {
        setViewMode(viewMode === 'grid' ? 'list' : 'grid');
        return;
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setCommandPaletteOpen, toggleSidebar, closeDetailPanel, setViewMode, viewMode, clearSelection]);

  return null;
}
