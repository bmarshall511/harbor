import { NextResponse } from 'next/server';
import * as path from 'node:path';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import {
  ArchiveMetadataService,
  LocalFilesystemProvider,
  DropboxProvider,
} from '@harbor/providers';
import { fileUpdatePayloadFromJson, metaRootForArchive } from '@harbor/jobs';
import type { StorageProvider } from '@harbor/types';
import { requireAuth, requirePermission, permissionService } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { serializeFile } from '@/lib/file-dto';
import { getSecret } from '@/lib/secrets';
import { withFileWriteLock } from '@harbor/utils';
import { syncMetadataToDropbox } from '@/lib/dropbox-metadata-sync';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();
const archiveMeta = new ArchiveMetadataService();

/**
 * POST /api/files/:id/rename
 *
 * Accepts `{ newName?, fileCreatedAt? | null }`. Either field may be
 * provided independently:
 *
 * • `newName` — physically renames the file through the archive-root
 *   provider (local FS or Dropbox), updates the `.harbor` sidecar
 *   index + item JSON, then mirrors `name` and `path` in the DB.
 *
 * • `fileCreatedAt` — writes a user-supplied creation date into the
 *   canonical JSON sidecar as `system.createdAtOverride`, so future
 *   reindexes preserve it; then mirrors the value into the DB
 *   `fileCreatedAt` column. Passing `null` clears the override.
 *
 * The route is permission-gated per-field: `files:write` for rename,
 * `metadata:write` for date edits. Provider operations run *before*
 * any DB writes so a provider failure leaves the DB untouched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    newName?: unknown;
    fileCreatedAt?: unknown;
  };

  const newName = typeof body.newName === 'string' ? body.newName.trim() : undefined;
  const hasDateField = Object.prototype.hasOwnProperty.call(body, 'fileCreatedAt');
  // `null` → clear override; string → set override; absent → leave alone.
  let parsedCreatedAt: Date | null | undefined;
  if (hasDateField) {
    if (body.fileCreatedAt === null) {
      parsedCreatedAt = null;
    } else if (typeof body.fileCreatedAt === 'string') {
      const d = new Date(body.fileCreatedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ message: 'fileCreatedAt must be a valid ISO date' }, { status: 400 });
      }
      parsedCreatedAt = d;
    } else {
      return NextResponse.json({ message: 'fileCreatedAt must be a string or null' }, { status: 400 });
    }
  }

  if (!newName && parsedCreatedAt === undefined) {
    return NextResponse.json({ message: 'No changes provided' }, { status: 400 });
  }

  // Per-field permission checks.
  if (newName !== undefined) {
    const denied = requirePermission(auth, 'files', 'write');
    if (denied) return denied;
  }
  if (parsedCreatedAt !== undefined) {
    const denied = requirePermission(auth, 'metadata', 'write');
    if (denied) return denied;
  }

  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  // Rename is gated by the archive root's capability flags regardless
  // of whether we're only editing the date — date edits go through
  // the metadata path below, which doesn't need this check.
  const willRename = Boolean(newName && newName !== file.name);
  if (willRename && !permissionService.canPerformFileOperation(auth, 'RENAME', root.capabilities)) {
    return NextResponse.json({ message: 'Rename not permitted on this archive root' }, { status: 403 });
  }

  const metaRoot = metaRootForArchive(
    root.id,
    root.rootPath,
    root.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
  );

  // Validate the name before touching anything — this is cheap and
  // doesn't need to run under the lock.
  let nextName = file.name;
  let nextRelPath = file.path;
  if (willRename) {
    const trimmed = newName!;
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return NextResponse.json({ message: 'Name cannot contain path separators' }, { status: 400 });
    }
    const dir = path.posix.dirname(file.path);
    nextRelPath = dir === '.' || dir === '' ? trimmed : path.posix.join(dir, trimmed);
    nextName = trimmed;
  }

  // The whole write pipeline runs under a per-file lock so a
  // simultaneous PATCH /files/:id or second rename can't trample the
  // sidecar JSON or the DB row. The provider rename itself is also
  // serialised, which prevents two rename requests for the same file
  // from racing to the filesystem.
  let updated: Awaited<ReturnType<typeof fileRepo.findById>> | null = null;
  try {
    updated = await withFileWriteLock(id, async () => {
      // ─── 1. Physical rename through the provider ──────────────
      if (willRename) {
        const provider = await createProviderForRoot(root, auth.userId);

        // Dropbox paths are absolute; local paths are relative to the root.
        const providerPath =
          root.providerType === 'DROPBOX'
            ? `${root.rootPath === '/' ? '' : root.rootPath}/${file.path}`
            : file.path;

        await provider.renameFile(providerPath, nextName);

        // Patch the sidecar index + item JSON `system.path`/`system.name`
        // so the stable UUID still resolves from the new path. Failure
        // here is non-fatal — the sidecar will self-heal on next
        // reindex, but we log it.
        try {
          await archiveMeta.renameItem(metaRoot, file.path, nextRelPath);
        } catch (err) {
          console.error('[Rename] Sidecar renameItem failed (non-fatal):', err);
        }
      }

      // ─── 2. Date override ──────────────────────────────────────
      if (parsedCreatedAt !== undefined) {
        const { item } = await archiveMeta.updateItem(
          metaRoot,
          nextRelPath,
          {
            name: nextName,
            hash: file.hash ?? undefined,
            createdAt: file.fileCreatedAt,
            modifiedAt: file.fileModifiedAt,
          },
          {
            systemOverride: {
              createdAtOverride: parsedCreatedAt === null ? null : parsedCreatedAt.toISOString(),
            },
            forceUuid: file.harborItemId,
          },
        );

        // Fire-and-forget Dropbox mirror — same pattern as PATCH.
        if (root.providerType === 'DROPBOX') {
          const itemJson = JSON.stringify(item, null, 2);
          syncMetadataToDropbox(root.id, `items/${file.harborItemId}.json`, itemJson)
            .catch((err) => console.error('[Rename] Dropbox sidecar sync failed:', err));
        }
      }

      // ─── 3. Mirror to the DB row ───────────────────────────────
      const dbUpdate: { name?: string; path?: string; fileCreatedAt?: Date | null } = {};
      if (willRename) {
        dbUpdate.name = nextName;
        dbUpdate.path = nextRelPath;
      }
      if (parsedCreatedAt !== undefined) {
        dbUpdate.fileCreatedAt = parsedCreatedAt;
      }
      await fileRepo.update(id, dbUpdate);
      return fileRepo.findById(id);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rename failed';
    return NextResponse.json({ message }, { status: 500 });
  }

  if (!updated) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // ─── 4. Audit + realtime fanout ──────────────────────────────────
  if (willRename) {
    await audit(auth, 'rename', 'FILE', id, { name: file.name, path: file.path }, { name: nextName, path: nextRelPath });
  }
  if (parsedCreatedAt !== undefined) {
    await audit(
      auth,
      'update',
      'FILE',
      id,
      { fileCreatedAt: file.fileCreatedAt?.toISOString() ?? null },
      { fileCreatedAt: parsedCreatedAt ? parsedCreatedAt.toISOString() : null },
    );
  }
  emit(
    'file.updated',
    { fileId: id, path: nextRelPath, archiveRootId: file.archiveRootId },
    { archiveRootId: file.archiveRootId, userId: auth.userId },
  );

  return NextResponse.json(serializeFile(updated));
}

/**
 * Build a `StorageProvider` for a given archive root. Kept local to
 * this route so we don't prematurely abstract across callers (the
 * reindex route has its own copy of the same logic — if a third
 * call site appears we should extract a shared helper then).
 */
async function createProviderForRoot(
  root: { id: string; name: string; providerType: string; rootPath: string },
  userId: string,
): Promise<StorageProvider> {
  if (root.providerType === 'LOCAL_FILESYSTEM') {
    return new LocalFilesystemProvider(root.id, root.name, root.rootPath);
  }

  if (root.providerType === 'DROPBOX') {
    const appKey = await getSecret('dropbox.appKey');
    const appSecret = await getSecret('dropbox.appSecret');
    if (!appKey || !appSecret) {
      throw new Error('Dropbox credentials not configured');
    }

    const token =
      (await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', userId },
        orderBy: { updatedAt: 'desc' },
      })) ??
      (await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX' },
        orderBy: { updatedAt: 'desc' },
      }));
    if (!token) throw new Error('No Dropbox access token found');

    const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
    const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;
    const provider = new DropboxProvider(root.id, root.name, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? undefined,
      appKey,
      appSecret,
      pathRoot,
    });
    provider.onTokenRefresh = async (newToken, expiresIn) => {
      await db.providerToken.update({
        where: { id: token.id },
        data: { accessToken: newToken, expiresAt: new Date(Date.now() + expiresIn * 1000) },
      });
    };
    return provider;
  }

  throw new Error(`Unsupported provider type: ${root.providerType}`);
}
