import { create } from 'zustand';
import type { FileDto, FolderDto, ArchiveRootDto } from '@harbor/types';

interface AppState {
  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Navigation
  activeArchiveRootId: string | null;
  setActiveArchiveRootId: (id: string | null) => void;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;

  // Selection
  selectedFileIds: Set<string>;
  lastSelectedFileId: string | null;
  selectFile: (id: string) => void;
  deselectFile: (id: string) => void;
  toggleFileSelection: (id: string) => void;
  selectMultipleFiles: (ids: string[]) => void;
  selectRange: (ids: string[]) => void;
  clearSelection: () => void;

  // Detail panel
  detailPanelOpen: boolean;
  detailPanelEntityType: 'file' | 'folder' | null;
  detailPanelEntityId: string | null;
  openDetailPanel: (entityType: 'file' | 'folder', entityId: string) => void;
  closeDetailPanel: () => void;

  // View mode
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;

  // Grid size (continuous value 80-400 px)
  gridColWidth: number;
  setGridColWidth: (width: number) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Media viewer
  viewerFileId: string | null;
  viewerFiles: FileDto[];
  openViewer: (fileId: string, files: FileDto[]) => void;
  closeViewer: () => void;
  setViewerFileId: (fileId: string) => void;

  // Browse context — when set, the detail panel's "View" button will
  // seed the lightbox with this list instead of falling back to
  // folder siblings. Pages like /favorites and /collections set this
  // on mount so the user's slideshow runs across the list they were
  // actually browsing, not the underlying folder of whichever file
  // they happened to click first.
  browseContextFiles: FileDto[] | null;
  browseContextLabel: string | null;
  setBrowseContext: (label: string, files: FileDto[]) => void;
  clearBrowseContext: () => void;

  // Lightbox preferences (persisted to localStorage)
  videoMuted: boolean;
  setVideoMuted: (muted: boolean) => void;
  theaterMode: boolean;
  setTheaterMode: (on: boolean) => void;
  toggleTheaterMode: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Sidebar
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Navigation
  activeArchiveRootId: null,
  setActiveArchiveRootId: (id) => set({ activeArchiveRootId: id, activeFolderId: null }),
  activeFolderId: null,
  setActiveFolderId: (id) => set({ activeFolderId: id }),

  // Selection
  selectedFileIds: new Set(),
  lastSelectedFileId: null as string | null,
  selectFile: (id) => set((s) => ({ selectedFileIds: new Set(s.selectedFileIds).add(id), lastSelectedFileId: id })),
  deselectFile: (id) =>
    set((s) => {
      const next = new Set(s.selectedFileIds);
      next.delete(id);
      return { selectedFileIds: next };
    }),
  toggleFileSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedFileIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedFileIds: next, lastSelectedFileId: id };
    }),
  selectMultipleFiles: (ids) => set({ selectedFileIds: new Set(ids), lastSelectedFileId: ids[ids.length - 1] ?? null }),
  selectRange: (ids: string[]) => set((s) => {
    const next = new Set(s.selectedFileIds);
    for (const id of ids) next.add(id);
    return { selectedFileIds: next, lastSelectedFileId: ids[ids.length - 1] ?? s.lastSelectedFileId };
  }),
  clearSelection: () => set({ selectedFileIds: new Set(), lastSelectedFileId: null }),

  // Detail panel
  detailPanelOpen: false,
  detailPanelEntityType: null,
  detailPanelEntityId: null,
  openDetailPanel: (entityType, entityId) =>
    set({ detailPanelOpen: true, detailPanelEntityType: entityType, detailPanelEntityId: entityId }),
  closeDetailPanel: () =>
    set({ detailPanelOpen: false, detailPanelEntityType: null, detailPanelEntityId: null }),

  // View mode
  viewMode: 'grid',
  setViewMode: (mode) => set({ viewMode: mode }),

  // Grid size (continuous value persisted to localStorage)
  gridColWidth: 180,
  setGridColWidth: (width) => {
    try { localStorage.setItem('harbor-grid-col-width', String(width)); } catch { /* SSR */ }
    set({ gridColWidth: width });
  },

  // Command palette
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  // Media viewer
  viewerFileId: null,
  viewerFiles: [],
  openViewer: (fileId, files) => set({ viewerFileId: fileId, viewerFiles: files }),
  closeViewer: () => set({ viewerFileId: null, viewerFiles: [] }),
  setViewerFileId: (fileId) => set({ viewerFileId: fileId }),

  // Browse context (see interface comment)
  browseContextFiles: null,
  browseContextLabel: null,
  setBrowseContext: (label, files) => set({ browseContextLabel: label, browseContextFiles: files }),
  clearBrowseContext: () => set({ browseContextLabel: null, browseContextFiles: null }),

  // Lightbox preferences. `videoMuted` is persisted via StoreHydrator
  // (mute is a sticky user preference). `theaterMode` is intentionally
  // per-session — see StoreHydrator for the regression that taught us
  // why persisting it is a bad idea.
  videoMuted: true,
  setVideoMuted: (muted) => {
    try { localStorage.setItem('harbor-video-muted', muted ? '1' : '0'); } catch { /* SSR */ }
    set({ videoMuted: muted });
  },
  theaterMode: false,
  setTheaterMode: (on) => set({ theaterMode: on }),
  toggleTheaterMode: () => set((s) => ({ theaterMode: !s.theaterMode })),
}));
