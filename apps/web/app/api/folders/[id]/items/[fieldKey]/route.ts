import { NextResponse } from 'next/server';
import { FolderRepository, TagRepository } from '@harbor/database';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

const folderRepo = new FolderRepository();
const tagRepo = new TagRepository();

/**
 * Folder counterpart to /api/files/[id]/items/[fieldKey]. Today the
 * only array-typed metadata folders carry is `tags`, but the same
 * shape is used so the client can call both endpoints uniformly.
 *
 *   POST /api/folders/:id/items/tags
 *     body: { op: 'add', value: 'tagName' }
 *     body: { op: 'remove', value: 'tagName' }
 *
 * Each op runs as a single relational mutation on the FolderTag
 * join table. There's no canonical sidecar for folders, so no lock
 * is needed beyond Postgres's own row-level guarantees.
 */

const ALLOWED_OPS = new Set(['add', 'remove']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldKey: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'metadata', 'write');
  if (denied) return denied;

  const { id, fieldKey } = await params;

  if (fieldKey !== 'tags') {
    return NextResponse.json(
      { message: `Folder field '${fieldKey}' is not editable` },
      { status: 400 },
    );
  }
  if (!permissionService.hasPermission(auth, 'items.tags', 'edit')) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'No edit permission for tags' },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { op?: string; value?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: 'Body must be a JSON object' }, { status: 400 });
  }
  const op = body.op;
  if (!op || !ALLOWED_OPS.has(op)) {
    return NextResponse.json(
      { message: `op must be one of: ${[...ALLOWED_OPS].join(', ')}` },
      { status: 400 },
    );
  }
  const tagName = typeof body.value === 'string' ? body.value.trim() : '';
  if (!tagName) {
    return NextResponse.json({ message: 'value (tag name) is required' }, { status: 400 });
  }

  const folder = await folderRepo.findById(id);
  if (!folder) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  if (op === 'add') {
    const tag = await tagRepo.findOrCreate(tagName);
    await tagRepo.addToFolder(id, tag.id);
    await audit(auth, 'update', 'FOLDER', id, null, { fieldKey, op, value: tagName });
    emit('tag.added', { entityType: 'FOLDER', entityId: id }, { userId: auth.userId });
  } else {
    const tag = await tagRepo.findByName(tagName);
    if (tag) {
      try {
        await tagRepo.removeFromFolder(id, tag.id);
      } catch {
        // already gone — no-op
      }
    }
    await audit(auth, 'update', 'FOLDER', id, null, { fieldKey, op, value: tagName });
    emit('tag.removed', { entityType: 'FOLDER', entityId: id }, { userId: auth.userId });
  }

  return NextResponse.json({ ok: true });
}
