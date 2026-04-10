'use client';

import { useRef, useState, useEffect, memo } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { FileDto } from '@harbor/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { FileContextMenu } from '@/components/context-menus';
import { formatBytes, getMimeCategory, friendlyName } from '@harbor/utils';
import {
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
  Star,
  Check,
} from 'lucide-react';

const MIME_ICONS: Record<string, typeof File> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  text: FileText,
  pdf: FileText,
  document: FileText,
};

const ROW_HEIGHT = 40;
const VIRTUALIZE_THRESHOLD = 100;

export function FileList({ files }: { files: FileDto[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setHeight(entries[0]?.contentRect.height ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const header = (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <div className="w-5" />
      <div>Name</div>
      <div className="w-16 text-right">Size</div>
      <div className="w-24 text-right">Modified</div>
      <div className="w-12 text-right">Rating</div>
    </div>
  );

  if (files.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="space-y-0.5" role="list" aria-label="Files">
        {header}
        {files.map((file) => (
          <FileListItem key={file.id} file={file} />
        ))}
      </div>
    );
  }

  return (
    <div role="list" aria-label="Files">
      {header}
      <div ref={containerRef} className="h-full flex-1" style={{ minHeight: Math.min(files.length * ROW_HEIGHT, 600) }}>
        {height > 0 && (
          <FixedSizeList
            height={Math.min(height, files.length * ROW_HEIGHT)}
            width="100%"
            itemCount={files.length}
            itemSize={ROW_HEIGHT}
            itemData={files}
            overscanCount={10}
          >
            {ListRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

const ListRow = memo(function ListRow({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: FileDto[];
}) {
  return (
    <div style={style}>
      <FileListItem file={data[index]} />
    </div>
  );
});

function FileListItem({ file }: { file: FileDto }) {
  const selectedFileIds = useAppStore((s) => s.selectedFileIds);
  const toggleFileSelection = useAppStore((s) => s.toggleFileSelection);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const isSelected = selectedFileIds.has(file.id);
  const category = getMimeCategory(file.mimeType);
  const Icon = MIME_ICONS[category] ?? File;

  const modified = file.fileModifiedAt
    ? new Date(file.fileModifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <FileContextMenu file={file}>
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/harbor-file-id', file.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          toggleFileSelection(file.id);
        } else {
          openDetailPanel('file', file.id);
        }
      }}
      className={cn(
        'grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-md px-3 py-2 text-sm',
        'transition-all duration-100 ease-out',
        'hover:bg-accent',
        'focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'bg-accent',
      )}
      role="listitem"
      aria-selected={isSelected}
    >
      <div className={cn(
        'flex h-5 w-5 items-center justify-center rounded border transition-colors',
        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}>
        {isSelected ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
      </div>

      <div className="flex items-center gap-1.5 truncate text-left">
        <span className="truncate font-medium" title={file.name}>{file.title ?? friendlyName(file.name)}</span>
        {(() => {
          const duration = file.meta?.fields?.duration as number | undefined;
          if (category !== 'video' || duration == null) return null;
          return (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          );
        })()}
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">{formatBytes(file.size)}</span>
      <span className="w-24 text-right text-xs text-muted-foreground">{modified}</span>

      <div className="flex w-12 items-center justify-end gap-0.5">
        {file.rating ? (
          <>
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" aria-hidden="true" />
            <span className="text-xs">{file.rating}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </button>
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
