import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { getSetting } from '@/lib/settings';
import { isCloudMode } from '@/lib/deployment';
import { emit } from '@/lib/events';
import { toProviderPath } from '@/lib/provider-paths';
// sharp loaded dynamically in generatePreviewFromCache
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

/** Resolve the local filesystem path for a Dropbox file (via Dropbox desktop sync). */
function resolveDropboxLocalPath(filePath: string): string | null {
  // Dropbox desktop syncs to ~/Dropbox/ or ~/<Team> Dropbox/
  const homeDir = process.env.HOME ?? '';
  const candidates = [
    // Add team-specific Dropbox folder name from DROPBOX_TEAM_FOLDER env if set
    ...(process.env.DROPBOX_TEAM_FOLDER ? [path.join(homeDir, process.env.DROPBOX_TEAM_FOLDER, filePath)] : []),
    path.join(homeDir, 'Dropbox', filePath),
  ];
  return candidates[0]; // Will be validated with stat
}

/**
 * GET /api/files/:id/cache
 *
 * Reports the offline-availability state for a file. The fields the
 * UI uses to drive the "Make available offline" affordance:
 *
 *   • providerType  — 'LOCAL_FILESYSTEM' files are always available;
 *                     'DROPBOX' files may need a download
 *   • cached        — Harbor's offline cache has the bytes
 *   • cacheSize     — bytes of cached payload (0 when not cached)
 *   • streamable    — `true` for any file the stream/preview routes
 *                     can serve right now (local always; Dropbox
 *                     when cached or available via desktop sync)
 *
 * The lightbox / detail-panel branch on `streamable`: when `false`
 * for a Dropbox file they render the offline placeholder with the
 * download CTA instead of the broken `<img>` / `<video>`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  const providerType = root?.providerType ?? 'LOCAL_FILESYSTEM';

  const cacheDir = await getSetting('preview.cacheDir');
  const cachePath = path.join(cacheDir, 'offline', id);

  let cached = false;
  let cacheSize = 0;
  try {
    const stat = await fs.stat(cachePath);
    cached = stat.size > 0;
    cacheSize = stat.size;
  } catch { /* not cached */ }

  let streamable = false;
  if (providerType === 'LOCAL_FILESYSTEM') {
    // Local files are always streamable when the file row exists
    // and the underlying disk file isn't an empty stub.
    streamable = file.size > 0n || cached;
  } else {
    // Dropbox files are streamable when our offline cache has the
    // bytes OR when the Dropbox desktop sync surface has them.
    // In cloud mode the stream route proxies directly from Dropbox,
    // so Dropbox files are always streamable without a local cache.
    if (isCloudMode) {
      streamable = true;
    } else if (cached) {
      streamable = true;
    } else {
      const dbxAbsolute = root ? toProviderPath(file.path, { providerType: root.providerType, rootPath: root.rootPath }) : null;
      const localPath = dbxAbsolute ? resolveDropboxLocalPath(dbxAbsolute.replace(/^\//, '')) : null;
      if (localPath) {
        try {
          const stat = await fs.stat(localPath);
          if (stat.size > 0) streamable = true;
        } catch { /* not on disk */ }
      }
    }
  }

  return NextResponse.json({
    providerType,
    cached,
    cacheSize,
    streamable,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const file = await fileRepo.findById(id);
    if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

    const root = await rootRepo.findById(file.archiveRootId);
    if (!root || root.providerType !== 'DROPBOX') {
      return NextResponse.json({ message: 'Only Dropbox files can be cached offline' }, { status: 400 });
    }

    const cacheDir = await getSetting('preview.cacheDir');
    const offlineDir = path.join(cacheDir, 'offline');
    await fs.mkdir(offlineDir, { recursive: true });
    const cachePath = path.join(offlineDir, id);

    // Canonical `file.path` is root-relative. Dropbox needs the full
    // absolute path (e.g. `/My Archive/Photos/foo.jpg`).
    const dropboxPath = toProviderPath(file.path, { providerType: root.providerType, rootPath: root.rootPath });

    // Strategy 1: Check if file exists locally via Dropbox desktop sync.
    // The desktop sync folder mirrors the full Dropbox tree, so we need
    // the rebuilt path here too.
    const localPath = resolveDropboxLocalPath(dropboxPath.replace(/^\//, ''));
    if (localPath) {
      try {
        const stat = await fs.stat(localPath);
        if (stat.size > 0) {
          const data = await fs.readFile(localPath);
          await fs.writeFile(cachePath, data);

          // Also generate preview from the cached file
          await generatePreviewFromCache(id, file, cachePath, cacheDir);

          // Notify listeners so the UI refreshes the file (its preview
          // count changed) without requiring a manual refetch.
          emit(
            'file.updated',
            { fileId: id, path: file.path, archiveRootId: file.archiveRootId },
            { archiveRootId: file.archiveRootId, userId: auth.userId },
          );
          emit(
            'preview.ready',
            { fileId: id, size: 'LARGE', path: cachePath },
            { archiveRootId: file.archiveRootId, userId: auth.userId },
          );

          return NextResponse.json({ cached: true, cacheSize: stat.size });
        }
      } catch { /* Not available locally, try Dropbox API */ }
    }

    // Strategy 2: Download via Dropbox API
    const token = await db.providerToken.findFirst({
      where: { providerType: 'DROPBOX', userId: auth.userId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!token) return NextResponse.json({ message: 'Dropbox not connected and file not available locally' }, { status: 401 });

    const appKey = await getSecret('dropbox.appKey') ?? '';
    const appSecret = await getSecret('dropbox.appSecret') ?? '';
    const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
    const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

    const provider = new DropboxProvider('cache', 'Cache', {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? undefined,
      appKey, appSecret, pathRoot,
    });

    // When `pathRoot` (Dropbox-API-Path-Root) is set, the namespace
    // header already scopes into the root. The file's root-relative
    // path is all the API needs — prepending `rootPath` again would
    // double the prefix (the exact "path/not_found" bug we saw).
    const apiPath = toProviderPath(file.path, {
      providerType: root.providerType,
      rootPath: root.rootPath,
    });

    console.log('[Cache] Dropbox download', {
      fileId: id,
      relativePath: file.path,
      apiPath,
      rootPath: root.rootPath,
      pathRoot: pathRoot ?? null,
    });

    const data = await provider.readFile(apiPath);
    await fs.writeFile(cachePath, data);

    // Generate preview from cached file
    await generatePreviewFromCache(id, file, cachePath, cacheDir);

    // Notify listeners so the UI updates immediately.
    emit(
      'file.updated',
      { fileId: id, path: file.path, archiveRootId: file.archiveRootId },
      { archiveRootId: file.archiveRootId, userId: auth.userId },
    );
    emit(
      'preview.ready',
      { fileId: id, size: 'LARGE', path: cachePath },
      { archiveRootId: file.archiveRootId, userId: auth.userId },
    );

    return NextResponse.json({ cached: true, cacheSize: data.length });
  } catch (err) {
    console.error(`[Cache] Failed to cache file ${id}:`, err);
    const message = err instanceof Error ? err.message : 'Failed to cache file';
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const cacheDir = await getSetting('preview.cacheDir');
  const cachePath = path.join(cacheDir, 'offline', id);

  try { await fs.unlink(cachePath); } catch { /* already gone */ }

  return NextResponse.json({ cached: false });
}

/** Generate preview thumbnails from a cached offline file using ffmpeg + sharp. */
async function generatePreviewFromCache(fileId: string, file: any, cachePath: string, cacheDir: string): Promise<void> {
  const mimeType = file.mimeType ?? '';
  if (!mimeType.startsWith('video/') && !mimeType.startsWith('image/')) return;

  try {
    if (mimeType.startsWith('video/')) {
      // Check ffmpeg
      try { await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 }); } catch { return; }

      // Extract frame
      let frameBuffer: Buffer | null = null;
      try {
        const { stdout } = await execFileAsync('ffmpeg', [
          '-i', cachePath, '-vframes', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', '-y', 'pipe:1',
        ], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
        if (stdout.length > 0) frameBuffer = stdout;
      } catch { return; }

      if (!frameBuffer) return;

      // Probe metadata. Width/height/duration now live under
      // `meta.fields.*` rather than as typed columns, so we route
      // the write through the metadata service which both updates
      // the on-disk JSON and mirrors it back into the row's `meta`
      // JSONB column.
      try {
        const { stdout: probeOut } = await execFileAsync('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', cachePath,
        ], { timeout: 10000 });
        const probe = JSON.parse(probeOut);
        const vs = probe.streams?.find((s: any) => s.codec_type === 'video');
        const dur = probe.format?.duration ? parseFloat(probe.format.duration) : null;
        const fields: Record<string, unknown> = {};
        if (dur && !isNaN(dur)) fields.duration = dur;
        if (vs?.width) fields.width = vs.width;
        if (vs?.height) fields.height = vs.height;
        if (Object.keys(fields).length > 0) {
          const { ArchiveMetadataService } = await import('@harbor/providers');
          const { metaRootForArchive, fileUpdatePayloadFromJson } = await import('@harbor/jobs');
          const archiveMeta = new ArchiveMetadataService();
          // The cache route is Dropbox-only, but the metadata root
          // resolves the same way for any provider.
          const root = await rootRepo.findById(file.archiveRootId);
          if (root) {
            const metaRoot = metaRootForArchive(
              file.archiveRootId,
              root.rootPath,
              root.providerType === 'LOCAL_FILESYSTEM' ? 'local' : 'remote',
            );
            const { item } = await archiveMeta.updateItem(
              metaRoot,
              file.path,
              { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
              { fields },
            );
            await db.file.update({ where: { id: fileId }, data: fileUpdatePayloadFromJson(item) });
          }
        }
      } catch { /* non-fatal */ }

      // Generate preview sizes using sharp
      const sharp = (await import('sharp' as string)).default as any;
      const sizes = [
        { size: 'THUMBNAIL' as const, width: 200 },
        { size: 'SMALL' as const, width: 400 },
        { size: 'MEDIUM' as const, width: 800 },
        { size: 'LARGE' as const, width: 1600 },
      ];

      for (const { size, width } of sizes) {
        const outputDir = path.join(cacheDir, file.archiveRootId, size.toLowerCase());
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `${fileId}.webp`);

        const result = await sharp(frameBuffer)
          .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outputPath);

        await db.preview.upsert({
          where: { fileId_size: { fileId, size } },
          create: { fileId, size, format: 'webp', width: result.width, height: result.height, path: outputPath, byteSize: result.size },
          update: { width: result.width, height: result.height, path: outputPath, byteSize: result.size },
        });
      }
    } else if (mimeType.startsWith('image/')) {
      const sharp = (await import('sharp' as string)).default as any;
      const sourceBuffer = await fs.readFile(cachePath);
      const sizes = [
        { size: 'THUMBNAIL' as const, width: 200 },
        { size: 'SMALL' as const, width: 400 },
        { size: 'MEDIUM' as const, width: 800 },
        { size: 'LARGE' as const, width: 1600 },
      ];

      for (const { size, width } of sizes) {
        const outputDir = path.join(cacheDir, file.archiveRootId, size.toLowerCase());
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `${fileId}.webp`);

        const result = await sharp(sourceBuffer)
          .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outputPath);

        await db.preview.upsert({
          where: { fileId_size: { fileId, size } },
          create: { fileId, size, format: 'webp', width: result.width, height: result.height, path: outputPath, byteSize: result.size },
          update: { width: result.width, height: result.height, path: outputPath, byteSize: result.size },
        });
      }
    }
  } catch (err) {
    console.error(`[Cache] Preview generation failed for ${fileId}:`, err);
  }
}
