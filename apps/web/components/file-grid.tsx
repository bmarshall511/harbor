'use client';

import { useRef, useState, useEffect, memo } from 'react';
import { FixedSizeGrid, type GridChildComponentProps } from 'react-window';
import type { FileDto } from '@harbor/types';
import { useAppStore } from '@/lib/store';
import { getPreviewUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FileContextMenu } from '@/components/context-menus';
import { FileQuickActions } from '@/components/file-quick-actions';
import { getMimeCategory, friendlyName } from '@harbor/utils';
import { FileImage, FileVideo, FileAudio, FileText, File, Star, Check, Play, CloudOff } from 'lucide-react';

const MIME_ICONS: Record<string, typeof File> = {
  image: FileImage, video: FileVideo, audio: FileAudio, text: FileText, pdf: FileText, document: FileText,
};

const VIRTUALIZE_THRESHOLD = 60;

export function FileGrid({ files }: { files: FileDto[] }) {
  const gridColWidth = useAppStore((s) => s.gridColWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setDims({ w: el.offsetWidth, h: el.offsetHeight || 600 });
    });
    obs.observe(el);
    setDims({ w: el.offsetWidth, h: el.offsetHeight || 600 });
    return () => obs.disconnect();
  }, []);

  const gap = Math.max(6, Math.round(gridColWidth * 0.06));
  const rowExtra = Math.max(32, Math.round(gridColWidth * 0.2));

  if (files.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${gridColWidth}px, 1fr))`,
          gap: `${gap}px`,
        }}
        role="grid"
        aria-label="Files"
      >
        {files.map((file, i) => (
          <div key={file.id} className="animate-scale-in" style={{ animationDelay: `${Math.min(i * 20, 200)}ms`, animationFillMode: 'both' }}>
            <FileGridItem file={file} allFiles={files} />
          </div>
        ))}
      </div>
    );
  }

  // Virtualized: needs measured width
  const colCount = dims.w > 0
    ? Math.max(1, Math.floor((dims.w + gap) / (gridColWidth + gap)))
    : 4;
  const colWidth = dims.w > 0 ? Math.floor(dims.w / colCount) : gridColWidth;
  const rowHeight = colWidth + rowExtra;
  const rowCount = Math.ceil(files.length / colCount);
  const gridHeight = Math.min(rowCount * rowHeight, 800);

  return (
    <div ref={containerRef} style={{ height: gridHeight, minHeight: 400 }} role="grid" aria-label="Files">
      {dims.w > 0 && (
        <FixedSizeGrid
          columnCount={colCount}
          columnWidth={colWidth}
          rowCount={rowCount}
          rowHeight={rowHeight}
          height={gridHeight}
          width={dims.w}
          overscanRowCount={3}
          itemData={{ files, colCount }}
        >
          {GridCell}
        </FixedSizeGrid>
      )}
    </div>
  );
}

interface CellData { files: FileDto[]; colCount: number }

const GridCell = memo(function GridCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) {
  const idx = rowIndex * data.colCount + columnIndex;
  if (idx >= data.files.length) return <div style={style} />;
  return (
    <div style={{ ...style, padding: 4 }}>
      <FileGridItem file={data.files[idx]} allFiles={data.files} />
    </div>
  );
});

function FileGridItem({ file, allFiles }: { file: FileDto; allFiles?: FileDto[] }) {
  const selectedFileIds = useAppStore((s) => s.selectedFileIds);
  const lastSelectedFileId = useAppStore((s) => s.lastSelectedFileId);
  const toggleFileSelection = useAppStore((s) => s.toggleFileSelection);
  const selectRange = useAppStore((s) => s.selectRange);
  const selectFile = useAppStore((s) => s.selectFile);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const openViewer = useAppStore((s) => s.openViewer);
  const isSelected = selectedFileIds.has(file.id);
  const category = getMimeCategory(file.mimeType);
  const Icon = MIME_ICONS[category] ?? File;
  const hasThumbnail = file.previews?.length > 0 || category === 'image';
  const isVideo = category === 'video';
  const isViewable = category === 'image' || category === 'video';
  const [hovering, setHovering] = useState(false);
  const videoHoverRef = useRef<HTMLVideoElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    // Shift+click: range select
    if (e.shiftKey && lastSelectedFileId && allFiles) {
      const lastIdx = allFiles.findIndex((f) => f.id === lastSelectedFileId);
      const curIdx = allFiles.findIndex((f) => f.id === file.id);
      if (lastIdx >= 0 && curIdx >= 0) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        selectRange(allFiles.slice(start, end + 1).map((f) => f.id));
        return;
      }
    }
    // Ctrl/Cmd+click: toggle selection
    if (e.metaKey || e.ctrlKey) {
      toggleFileSelection(file.id);
      return;
    }
    // Regular click: open detail panel only (no selection highlight)
    openDetailPanel('file', file.id);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFileSelection(file.id);
  };

  const handleDoubleClick = () => {
    if (isViewable && allFiles) {
      const viewableFiles = allFiles.filter((f) => {
        const c = getMimeCategory(f.mimeType);
        return c === 'image' || c === 'video';
      });
      openViewer(file.id, viewableFiles);
    }
  };

  return (
    <FileContextMenu file={file}>
    <div
      draggable
      tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData('application/harbor-file-id', file.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e as any); } }}
      className={cn(
        'group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card',
        'transition-all duration-150 ease-out',
        'hover:border-primary/30 hover:shadow-md hover:-translate-y-px',
        'active:translate-y-0 active:shadow-sm',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        isSelected && 'border-primary ring-1 ring-primary',
      )}
      role="gridcell" aria-selected={isSelected} aria-label={file.title ?? file.name}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted"
        onMouseEnter={() => { if (isVideo && hasThumbnail) setHovering(true); }}
        onMouseLeave={() => { setHovering(false); if (videoHoverRef.current) { videoHoverRef.current.pause(); videoHoverRef.current.currentTime = 0; } }}
      >
        {hasThumbnail ? (
          <>
            <img src={getPreviewUrl(file.id, 'THUMBNAIL')} alt={(file.meta?.fields?.altText as string | undefined) ?? file.name}
              className={cn('h-full w-full object-cover', hovering && isVideo && 'opacity-0')} loading="lazy" />
            {hovering && isVideo && (
              <video ref={videoHoverRef} src={`/api/files/${file.id}/stream`} muted autoPlay loop playsInline
                className="absolute inset-0 h-full w-full object-cover" />
            )}
          </>
        ) : isVideo ? (
          file.size === 0 ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-amber-500/10 to-amber-500/5">
              <CloudOff className="h-6 w-6 text-amber-400/50" aria-hidden="true" />
              <span className="mt-1.5 text-[10px] font-medium text-amber-400/60">Offline</span>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-purple-500/10 to-purple-500/5">
              <div className="rounded-full bg-purple-500/15 p-3">
                <Play className="h-6 w-6 text-purple-400/80 fill-purple-400/80" aria-hidden="true" />
              </div>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-purple-400/60">
                {file.mimeType?.split('/')[1]?.toUpperCase() ?? 'Video'}
              </span>
              <span className="mt-0.5 text-[9px] text-muted-foreground/50">Preview not cached</span>
            </div>
          )
        ) : (
          <div className={cn('flex h-full w-full items-center justify-center',
            category === 'audio' && 'bg-amber-500/5',
            category === 'pdf' && 'bg-red-500/5', category === 'text' && 'bg-blue-500/5',
            category === 'document' && 'bg-green-500/5',
          )}>
            <Icon className={cn('h-8 w-8',
              category === 'audio' && 'text-amber-400/60',
              category === 'pdf' && 'text-red-400/60', category === 'text' && 'text-blue-400/60',
              category === 'document' && 'text-green-400/60',
              (category === 'other' || category === 'archive') && 'text-muted-foreground/40',
            )} aria-hidden="true" />
          </div>
        )}
        <button
          onClick={handleCheckboxClick}
          className={cn('absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border transition-all z-10',
            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/60 bg-black/20 opacity-0 group-hover:opacity-100',
          )}
          aria-label={isSelected ? 'Deselect' : 'Select'}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </button>
        {isVideo && hasThumbnail && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
            <Play className="h-4 w-4 text-white fill-white" aria-hidden="true" />
          </div>
        )}
        {(() => {
          const duration = file.meta?.fields?.duration as number | undefined;
          if (!isVideo || duration == null) return null;
          return (
            <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5">
              <span className="text-[10px] font-medium text-white tabular-nums">{formatDuration(duration)}</span>
            </div>
          );
        })()}
        {file.rating && (
          <div className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" aria-hidden="true" />
            <span className="text-[10px] font-medium text-white">{file.rating}</span>
          </div>
        )}
        {/* Quick actions: favorite + add-to-collection. Visible on hover. */}
        <div className="absolute bottom-1 right-1 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <FileQuickActions fileId={file.id} size="card" variant="dark" />
        </div>
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-xs font-medium" title={file.name}>{file.title ?? friendlyName(file.name)}</p>
      </div>
    </div>
    </FileContextMenu>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
