import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { applyIgnoreFilter } from '@/lib/file-filters';
import { serializeFile } from '@/lib/file-dto';

/**
 * Recently-viewed history.
 *
 * GET  → returns the current user's most recently viewed files,
 *        newest first. The DB carries the truth, not localStorage,
 *        so the list survives a browser-data clear and syncs across
 *        the web and Electron clients.
 *
 * POST → records a fresh view of a file. Body: `{ fileId }`. The
 *        store uses an upsert keyed on (userId, fileId) so re-viewing
 *        a file just bumps `viewedAt`.
 *
 * DELETE → clears the entire history for the current user.
 */

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 18));

  const rows = await db.recentView.findMany({
    where: { userId: auth.userId },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    include: {
      file: {
        include: {
          tags: { include: { tag: true } },
          previews: { where: { size: 'THUMBNAIL' } },
        },
      },
    },
  });

  // Filter out anything that should be hidden by user-configured
  // ignore patterns or that's been deleted.
  const files = rows
    .map((r) => r.file)
    .filter((f) => f.status !== 'DELETED' && f.status !== 'PENDING_DELETE');
  const visible = await applyIgnoreFilter(files);
  return NextResponse.json(visible.map((f) => serializeFile(f)));
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as { fileId?: string };
  if (!body.fileId) {
    return NextResponse.json({ message: 'fileId required' }, { status: 400 });
  }

  // Make sure the file actually exists before recording a view.
  const file = await db.file.findUnique({
    where: { id: body.fileId },
    select: { id: true },
  });
  if (!file) return NextResponse.json({ message: 'File not found' }, { status: 404 });

  await db.recentView.upsert({
    where: { userId_fileId: { userId: auth.userId, fileId: body.fileId } },
    create: { userId: auth.userId, fileId: body.fileId },
    update: { viewedAt: new Date() },
  });

  // Trim history to a sensible cap so the table doesn't grow forever.
  // Keep the 200 most recent per user; older entries are removed.
  const KEEP = 200;
  const overflow = await db.recentView.findMany({
    where: { userId: auth.userId },
    orderBy: { viewedAt: 'desc' },
    skip: KEEP,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await db.recentView.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  await db.recentView.deleteMany({ where: { userId: auth.userId } });
  return NextResponse.json({ ok: true });
}
