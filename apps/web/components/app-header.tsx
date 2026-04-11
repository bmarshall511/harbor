'use client';

import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/lib/use-auth';
import { IndexingStatus } from '@/components/indexing-status';
import {
  PanelLeft,
  LayoutGrid,
  List,
  Sun,
  Moon,
  Monitor,
  Search,
  Loader2,
  Keyboard,
  Eye,
  LogOut,
  User,
} from 'lucide-react';

export function AppHeader() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  const gridColWidth = useAppStore((s) => s.gridColWidth);
  const setGridColWidth = useAppStore((s) => s.setGridColWidth);

  const cycleTheme = () => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const idx = order.indexOf(theme as any);
    setTheme(order[(idx + 1) % order.length]);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <header className="flex h-12 items-center justify-between border-b border-border px-3" role="banner">
      <div className="flex items-center gap-1.5">
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        <IndexingStatus />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
          aria-label="Open search"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium sm:inline">⌘K</kbd>
        </button>

        <div className="ml-2 flex items-center rounded-md border border-border" role="group" aria-label="View mode">
          <button
            onClick={() => setViewMode('grid')}
            className={cn('rounded-l-md p-1.5 transition-colors', viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn('rounded-r-md p-1.5 transition-colors', viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        {viewMode === 'grid' && (
          <input
            type="range"
            min={80}
            max={400}
            step={10}
            value={gridColWidth}
            onChange={(e) => setGridColWidth(Number(e.target.value))}
            className="ml-2 h-1 w-20 cursor-pointer appearance-none rounded-full bg-border accent-primary sm:w-24"
            aria-label="Grid thumbnail size"
            title={`Thumbnail size: ${gridColWidth}px`}
          />
        )}

        <button
          onClick={cycleTheme}
          className="ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Theme: ${theme}. Click to cycle.`}
        >
          <ThemeIcon className="h-4 w-4" />
        </button>

        {user && (
          <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
            <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground" title={user.username}>
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline max-w-[80px] truncate">{user.displayName}</span>
            </div>
            <button
              onClick={() => logout()}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
