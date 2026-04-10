import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { isTextMime, isPdfMime } from '@harbor/utils';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

/**
 * GET /api/files/:id/content — Serve the raw text content of a file for inline preview.
 * Only serves text-like files (text/*, application/json, application/xml) up to 500KB.
 * For PDFs, returns basic page count info if available.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  if (root.providerType !== 'LOCAL_FILESYSTEM') {
    return NextResponse.json({ message: 'Content preview only available for local files' }, { status: 501 });
  }

  const fullPath = path.resolve(root.rootPath, file.path);

  // Text files: serve content up to 500KB
  if (isTextMime(file.mimeType)) {
    try {
      const stat = await fs.stat(fullPath);
      const maxSize = 512 * 1024; // 500KB
      const truncated = stat.size > maxSize;

      const content = await fs.readFile(fullPath, 'utf-8');
      const text = truncated ? content.slice(0, maxSize) : content;

      return NextResponse.json({
        type: 'text',
        content: text,
        truncated,
        totalSize: stat.size,
        mimeType: file.mimeType,
      });
    } catch {
      return NextResponse.json({ message: 'File not readable' }, { status: 404 });
    }
  }

  // PDF: return page count if we have it, or try to detect it
  if (isPdfMime(file.mimeType)) {
    try {
      // Read first 4KB to extract page count from PDF header
      const buffer = Buffer.alloc(4096);
      const handle = await fs.open(fullPath, 'r');
      await handle.read(buffer, 0, 4096, 0);
      await handle.close();

      const header = buffer.toString('ascii');
      // Page count now lives under `meta.fields.pageCount` (the
      // canonical JSON), with no DB column. Read it from the JSON
      // mirror on the row.
      const meta = (file.meta as { fields?: Record<string, unknown> } | null) ?? null;
      const pageCount = (meta?.fields?.pageCount as number | undefined) ?? null;

      return NextResponse.json({
        type: 'pdf',
        pageCount,
        size: Number(file.size),
        mimeType: file.mimeType,
      });
    } catch {
      const meta = (file.meta as { fields?: Record<string, unknown> } | null) ?? null;
      const pageCount = (meta?.fields?.pageCount as number | undefined) ?? null;
      return NextResponse.json({
        type: 'pdf',
        pageCount,
        size: Number(file.size),
        mimeType: file.mimeType,
      });
    }
  }

  return NextResponse.json({ message: 'Content preview not available for this file type' }, { status: 404 });
}
