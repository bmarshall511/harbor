import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db, SettingsRepository } from '@harbor/database';
import { guessMimeType } from '@harbor/utils';
import { LocalFilesystemProvider, DropboxProvider, ArchiveMetadataService } from '@harbor/providers';
import { fileUpdatePayloadFromJson, syncTagsForFile, metaRootForArchive, PreviewJob } from '@harbor/jobs';
import { getSecret } from '@/lib/secrets';
import type { StorageProvider } from '@harbor/types';

/**
 * POST /api/files/:id/reindex
 *
 * Re-indexes a single file: re-stats from disk/provider, re-reads
 * metadata JSON, updates the DB row, and regenerates previews.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  console.log(`[ReindexFile] Starting reindex for file ${id}`);

  try {
    // Load file + archive root
    const file = await db.file.findUnique({
      where: { id },
      include: { archiveRoot: true },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const root = file.archiveRoot;
    console.log(`[ReindexFile] File: ${file.name}, Root: ${root.name} (${root.providerType}), Path: ${file.path}`);

    // Create provider based on type
    let provider: StorageProvider;

    if (root.providerType === 'LOCAL_FILESYSTEM') {
      provider = new LocalFilesystemProvider(root.id, root.name, root.rootPath);
    } else if (root.providerType === 'DROPBOX') {
      const appKey = await getSecret('dropbox.appKey');
      const appSecret = await getSecret('dropbox.appSecret');
      if (!appKey || !appSecret) {
        return NextResponse.json({ error: 'Dropbox credentials not configured' }, { status: 400 });
      }

      const token = await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!token) {
        // Fallback: try any Dropbox token
        const anyToken = await db.providerToken.findFirst({
          where: { providerType: 'DROPBOX' },
          orderBy: { updatedAt: 'desc' },
        });
        if (!anyToken) {
          return NextResponse.json({ error: 'No Dropbox access token found' }, { status: 400 });
        }
        const tokenMeta = (anyToken.metadata as Record<string, unknown>) ?? {};
        const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;
        const dbxProvider = new DropboxProvider(root.id, root.name, {
          accessToken: anyToken.accessToken,
          refreshToken: anyToken.refreshToken ?? undefined,
          appKey,
          appSecret,
          pathRoot,
        });
        dbxProvider.onTokenRefresh = async (newToken, expiresIn) => {
          await db.providerToken.update({
            where: { id: anyToken.id },
            data: { accessToken: newToken, expiresAt: new Date(Date.now() + expiresIn * 1000) },
          });
        };
        provider = dbxProvider;
      } else {
        const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
        const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;
        const dbxProvider = new DropboxProvider(root.id, root.name, {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? undefined,
          appKey,
          appSecret,
          pathRoot,
        });
        dbxProvider.onTokenRefresh = async (newToken, expiresIn) => {
          await db.providerToken.update({
            where: { id: token.id },
            data: { accessToken: newToken, expiresAt: new Date(Date.now() + expiresIn * 1000) },
          });
        };
        provider = dbxProvider;
      }
    } else {
      return NextResponse.json({ error: `Unsupported provider: ${root.providerType}` }, { status: 400 });
    }

    const archiveMeta = new ArchiveMetadataService();

    // Provider path: local uses relative path, Dropbox needs the full
    // Dropbox-absolute path (rootPath + relative file path).
    const providerPath = root.providerType === 'DROPBOX'
      ? `${root.rootPath === '/' ? '' : root.rootPath}/${file.path}`
      : file.path;

    // Re-stat from provider
    console.log(`[ReindexFile] Getting metadata for: ${providerPath}`);
    const metadata = await provider.getMetadata(providerPath);
    const mimeType = guessMimeType(file.name) ?? metadata.mimeType;
    console.log(`[ReindexFile] Stat OK — size: ${metadata.size}, mime: ${mimeType}`);

    // Compute hash
    let hash: string | null = metadata.hash;
    if (provider.computeHash) {
      try { hash = await provider.computeHash(providerPath); } catch { /* non-fatal */ }
    }

    // Re-read the Harbor metadata JSON
    const itemMetaRoot = metaRootForArchive(root.id, root.rootPath, provider.type);
    const itemPayload = await archiveMeta.readItemByUuid(itemMetaRoot, file.harborItemId);
    console.log(`[ReindexFile] Metadata JSON: ${itemPayload ? 'found' : 'not found'}`);

    // Update the DB row
    await db.file.update({
      where: { id },
      data: {
        mimeType,
        size: metadata.size,
        hash,
        fileCreatedAt: metadata.createdAt,
        fileModifiedAt: metadata.modifiedAt,
        status: 'INDEXED',
        indexedAt: new Date(),
        ...(itemPayload ? fileUpdatePayloadFromJson(itemPayload) : {}),
      },
    });
    console.log(`[ReindexFile] DB row updated`);

    // Sync tags
    if (itemPayload) {
      await syncTagsForFile(id, itemPayload);
    }

    // Regenerate previews
    if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
      const settingsRepo = new SettingsRepository();
      const cacheDir = await settingsRepo.get('preview.cacheDir', './data/preview-cache');
      await db.preview.deleteMany({ where: { fileId: id } });

      if (root.providerType === 'LOCAL_FILESYSTEM') {
        const previewJob = new PreviewJob(cacheDir);
        await previewJob.generatePreviews(id).catch((err) => {
          console.error(`[ReindexFile] Preview generation failed:`, err);
        });
      } else if (root.providerType === 'DROPBOX' && mimeType.startsWith('image/')) {
        // For Dropbox: download the file, generate previews with Sharp,
        // then clean up the temp file.
        try {
          const fsp = await import('node:fs/promises');
          const nodePath = await import('node:path');
          const os = await import('node:os');
          const sharp = (await import('sharp')).default;

          console.log(`[ReindexFile] Downloading Dropbox file for preview generation...`);
          const fileBuffer = await provider.readFile(providerPath);
          console.log(`[ReindexFile] Downloaded ${fileBuffer.length} bytes`);

          const SIZES = [
            { size: 'THUMBNAIL', width: 200 },
            { size: 'SMALL', width: 400 },
            { size: 'MEDIUM', width: 800 },
            { size: 'LARGE', width: 1600 },
          ] as const;

          for (const { size, width } of SIZES) {
            const outputDir = nodePath.default.join(cacheDir, root.id, size.toLowerCase());
            await fsp.mkdir(outputDir, { recursive: true });
            const outputPath = nodePath.default.join(outputDir, `${id}.webp`);

            const result = await sharp(fileBuffer)
              .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 80 })
              .toFile(outputPath);

            await db.preview.create({
              data: {
                fileId: id,
                size: size as any,
                format: 'webp',
                width: result.width,
                height: result.height,
                path: outputPath,
                byteSize: result.size,
              },
            });
          }
          console.log(`[ReindexFile] Generated ${SIZES.length} preview sizes from Dropbox download`);
        } catch (previewErr) {
          console.error(`[ReindexFile] Dropbox preview generation failed:`, previewErr);
        }
      }
      console.log(`[ReindexFile] Previews regenerated`);
    }

    console.log(`[ReindexFile] Done — ${file.name}`);
    return NextResponse.json({ ok: true, file: { id, name: file.name, mimeType, size: Number(metadata.size), status: 'INDEXED' } });
  } catch (error) {
    console.error(`[ReindexFile] FULL ERROR:`, error);
    const message = error instanceof Error ? error.message : 'Reindex failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
