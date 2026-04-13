'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { FileText, FileIcon, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ContentPreviewProps {
  fileId: string;
  mimeType: string | null;
}

export function ContentPreview({ fileId, mimeType }: ContentPreviewProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['file-content', fileId],
    queryFn: async () => {
      const res = await fetch(`/api/files/${fileId}/content`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isPreviewable(mimeType),
    staleTime: 60 * 1000,
  });

  if (!isPreviewable(mimeType)) return null;
  if (isLoading) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-border bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Preview could not be loaded</span>
      </div>
    );
  }

  if (!data) return null;

  if (data.type === 'text') {
    return <TextPreview content={data.content} truncated={data.truncated} mimeType={data.mimeType} />;
  }

  if (data.type === 'pdf') {
    return <PdfInfo pageCount={data.pageCount} size={data.size} />;
  }

  return null;
}

function TextPreview({
  content,
  truncated,
  mimeType,
}: {
  content: string;
  truncated: boolean;
  mimeType: string;
}) {
  const isMarkdown = mimeType === 'text/markdown';
  const isJson = mimeType === 'application/json';

  let displayContent = content;
  if (isJson) {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // Use raw content if JSON parse fails
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/50">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <FileText className="h-3 w-3" />
          {isMarkdown ? 'Markdown' : isJson ? 'JSON' : 'Text'}
        </div>
        {truncated && (
          <span className="text-[10px] text-muted-foreground">Truncated preview</span>
        )}
      </div>
      {isMarkdown ? (
        <div className="max-h-[500px] overflow-auto p-4 prose prose-sm dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/80 prose-a:text-primary prose-code:text-xs prose-pre:bg-muted prose-pre:text-foreground/80 max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      ) : (
        <pre className={cn(
          'max-h-64 overflow-auto p-3 text-[11px] leading-relaxed text-foreground/80',
          'font-mono whitespace-pre-wrap break-words',
        )}>
          {displayContent}
        </pre>
      )}
    </div>
  );
}

function PdfInfo({ pageCount, size }: { pageCount: number | null; size: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-red-500/5 p-4">
      <div className="rounded-lg bg-red-500/10 p-2">
        <FileIcon className="h-6 w-6 text-red-400/70" />
      </div>
      <div>
        <p className="text-sm font-medium">PDF Document</p>
        <p className="text-xs text-muted-foreground">
          {pageCount ? `${pageCount} pages` : 'Page count unknown'}
          {' · '}
          {formatSize(size)}
        </p>
      </div>
    </div>
  );
}

function isPreviewable(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/pdf'
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
