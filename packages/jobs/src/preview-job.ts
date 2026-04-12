import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db, FileRepository, ArchiveRootRepository } from '@harbor/database';
import { ArchiveMetadataService } from '@harbor/providers';
import { isImageMime, isVideoMime, isPdfMime } from '@harbor/utils';
import { JobManager } from './job-manager';
import { metaRootForArchive } from './metadata-root';
import type { PreviewSize } from '@harbor/database';

const execFileAsync = promisify(execFile);

const PREVIEW_SIZES: Array<{ size: PreviewSize; width: number }> = [
  { size: 'THUMBNAIL', width: 200 },
  { size: 'SMALL', width: 400 },
  { size: 'MEDIUM', width: 800 },
  { size: 'LARGE', width: 1600 },
];

/** Cache ffmpeg availability so we only probe once per process. */
let ffmpegAvailable: boolean | null = null;
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    ffmpegAvailable = true;
    console.log('[PreviewJob] ffmpeg detected — video thumbnail generation enabled');
  } catch {
    ffmpegAvailable = false;
    console.log('[PreviewJob] ffmpeg not found — video thumbnails will not be generated. Install ffmpeg for video preview support.');
  }
  return ffmpegAvailable;
}

export class PreviewJob {
  private fileRepo = new FileRepository();
  private rootRepo = new ArchiveRootRepository();
  private jobManager = new JobManager();
  private archiveMeta = new ArchiveMetadataService();
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async generatePreviews(fileId: string): Promise<void> {
    const file = await this.fileRepo.findById(fileId);
    if (!file) throw new Error(`File ${fileId} not found`);

    const root = await this.rootRepo.findById(file.archiveRootId);
    if (!root) throw new Error(`Archive root not found`);

    if (isImageMime(file.mimeType)) {
      return this.generateImagePreviews(fileId, file, root);
    }

    if (isVideoMime(file.mimeType)) {
      return this.generateVideoPreviews(fileId, file, root);
    }
  }

  /** Generate scaled preview images from an image source file. */
  private async generateImagePreviews(fileId: string, file: any, root: any): Promise<void> {
    const jobId = await this.jobManager.enqueue({
      type: 'preview',
      entityType: 'FILE',
      entityId: fileId,
    });

    try {
      await this.jobManager.markRunning(jobId);

      const sharp = (await import('sharp')).default;
      const sourcePath = this.resolveLocalPath(root, file.path);
      const sourceBuffer = await fs.readFile(sourcePath);

      for (const { size, width } of PREVIEW_SIZES) {
        const outputDir = path.join(this.cacheDir, file.archiveRootId, size.toLowerCase());
        await fs.mkdir(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, `${file.id}.webp`);

        const result = await sharp(sourceBuffer)
          .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outputPath);

        if (size === 'THUMBNAIL') {
          const metadata = await sharp(sourceBuffer).metadata();
          if (metadata.width && metadata.height) {
            // Width/height/colorSpace now live in the on-disk JSON
            // (under `meta.fields`). The metadata service writes the
            // JSON and we mirror the result into the DB row's meta
            // column so search/filter still works.
            const fields: Record<string, unknown> = {
              width: metadata.width,
              height: metadata.height,
              colorSpace: metadata.space ?? undefined,
            };

            // Extract EXIF data if available
            if (metadata.exif) {
              try {
                const exifReader = (await import('exif-reader')).default;
                const exif = exifReader(metadata.exif);

                if (exif.Image) {
                  if (exif.Image.Make) fields.cameraMake = String(exif.Image.Make).trim();
                  if (exif.Image.Model) fields.cameraModel = String(exif.Image.Model).trim();
                  if (exif.Image.Software) fields.software = String(exif.Image.Software).trim();
                }
                if (exif.Photo) {
                  if (exif.Photo.ISO || exif.Photo.ISOSpeedRatings) {
                    const iso = exif.Photo.ISO ?? exif.Photo.ISOSpeedRatings;
                    fields.iso = Array.isArray(iso) ? iso[0] : iso;
                  }
                  if (exif.Photo.FNumber) fields.aperture = exif.Photo.FNumber;
                  if (exif.Photo.ExposureTime) {
                    const et = exif.Photo.ExposureTime;
                    fields.shutterSpeed = et < 1 ? `1/${Math.round(1 / et)}` : `${et}`;
                  }
                  if (exif.Photo.FocalLength) fields.focalLength = exif.Photo.FocalLength;
                  if (exif.Photo.FocalLengthIn35mmFilm) fields.focalLength35mm = exif.Photo.FocalLengthIn35mmFilm;
                  if (exif.Photo.LensModel) fields.lensModel = String(exif.Photo.LensModel).trim();
                  if (exif.Photo.ExposureProgram != null) {
                    const programs = ['Unknown', 'Manual', 'Program', 'Aperture Priority', 'Shutter Priority', 'Creative', 'Action', 'Portrait', 'Landscape'];
                    fields.exposureProgram = programs[exif.Photo.ExposureProgram] ?? undefined;
                  }
                  if (exif.Photo.WhiteBalance != null) {
                    fields.whiteBalance = exif.Photo.WhiteBalance === 0 ? 'Auto' : 'Manual';
                  }
                  if (exif.Photo.Flash != null) {
                    fields.flash = (exif.Photo.Flash & 1) === 1;
                  }
                  if (exif.Photo.DateTimeOriginal) {
                    fields.dateTaken = exif.Photo.DateTimeOriginal instanceof Date
                      ? exif.Photo.DateTimeOriginal.toISOString()
                      : String(exif.Photo.DateTimeOriginal);
                  }
                }
                if (exif.GPSInfo) {
                  const lat = exif.GPSInfo.GPSLatitude;
                  const lon = exif.GPSInfo.GPSLongitude;
                  const latRef = exif.GPSInfo.GPSLatitudeRef;
                  const lonRef = exif.GPSInfo.GPSLongitudeRef;
                  if (lat && lon) {
                    const toDecimal = (dms: number[]) => dms[0] + dms[1] / 60 + (dms[2] ?? 0) / 3600;
                    const latDec = toDecimal(lat) * (latRef === 'S' ? -1 : 1);
                    const lonDec = toDecimal(lon) * (lonRef === 'W' ? -1 : 1);
                    fields.gpsLatitude = latDec;
                    fields.gpsLongitude = lonDec;
                  }
                  if (exif.GPSInfo.GPSAltitude != null) {
                    fields.gpsAltitude = exif.GPSInfo.GPSAltitude;
                  }
                }

                console.log(`[PreviewJob] EXIF extracted for ${file.name}: camera=${fields.cameraMake} ${fields.cameraModel}, ISO=${fields.iso}, f/${fields.aperture}`);
              } catch (exifErr) {
                // EXIF parsing is non-fatal
                console.warn(`[PreviewJob] EXIF parse failed for ${file.name}:`, exifErr);
              }
            }

            const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, 'local');
            const { item } = await this.archiveMeta.updateItem(
              metaRoot,
              file.path,
              { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
              { fields },
            );
            await this.fileRepo.update(fileId, {
              meta: item as unknown as object,
            });
          }
        }

        await db.preview.upsert({
          where: { fileId_size: { fileId, size } },
          create: {
            fileId, size, format: 'webp',
            width: result.width, height: result.height,
            path: outputPath, byteSize: result.size,
          },
          update: {
            width: result.width, height: result.height,
            path: outputPath, byteSize: result.size,
          },
        });
      }

      await this.jobManager.markCompleted(jobId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Preview generation failed';
      await this.jobManager.markFailed(jobId, msg);
    }
  }

  /**
   * Generate thumbnail previews from a video file using ffmpeg.
   * Extracts a frame at 1 second (or 0 if very short), then uses sharp
   * to resize into the standard preview sizes.
   *
   * Also probes video metadata (duration, dimensions) via ffprobe.
   */
  /** Resolve a file's local path, handling both local and Dropbox desktop sync paths. */
  private resolveLocalPath(root: any, filePath: string): string {
    if (root.providerType === 'LOCAL_FILESYSTEM') {
      return path.resolve(root.rootPath, filePath);
    }
    // Dropbox desktop sync: files may be at ~/Dropbox/ or
    // ~/<TeamName> Dropbox/ for business accounts. The team folder
    // name is configurable via DROPBOX_TEAM_FOLDER env var.
    const homeDir = process.env.HOME ?? '';
    const teamFolder = process.env.DROPBOX_TEAM_FOLDER;
    const candidates = [
      ...(teamFolder ? [path.join(homeDir, teamFolder, filePath)] : []),
      path.join(homeDir, 'Dropbox', filePath),
    ];
    return candidates[0];
  }

  private async generateVideoPreviews(fileId: string, file: any, root: any): Promise<void> {
    if (!(await hasFfmpeg())) return;

    const sourcePath = this.resolveLocalPath(root, file.path);

    // Check file size — skip 0-byte offline stubs (e.g. Dropbox smart sync placeholders)
    try {
      const stat = await fs.stat(sourcePath);
      if (stat.size === 0) {
        console.log(`[PreviewJob] Skipping 0-byte video stub: ${file.path}`);
        return;
      }
    } catch {
      return; // File doesn't exist on disk
    }

    const jobId = await this.jobManager.enqueue({
      type: 'preview',
      entityType: 'FILE',
      entityId: fileId,
    });

    try {
      await this.jobManager.markRunning(jobId);

      // Probe video metadata first
      await this.probeVideoMetadata(fileId, sourcePath);

      // Extract a frame as JPEG via ffmpeg piped to stdout
      const frameBuffer = await this.extractVideoFrame(sourcePath);
      if (!frameBuffer || frameBuffer.length === 0) {
        await this.jobManager.markFailed(jobId, 'Failed to extract video frame');
        return;
      }

      // Use sharp to resize the extracted frame into standard preview sizes
      const sharp = (await import('sharp')).default;

      for (const { size, width } of PREVIEW_SIZES) {
        const outputDir = path.join(this.cacheDir, file.archiveRootId, size.toLowerCase());
        await fs.mkdir(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, `${file.id}.webp`);

        const result = await sharp(frameBuffer)
          .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outputPath);

        await db.preview.upsert({
          where: { fileId_size: { fileId, size } },
          create: {
            fileId, size, format: 'webp',
            width: result.width, height: result.height,
            path: outputPath, byteSize: result.size,
          },
          update: {
            width: result.width, height: result.height,
            path: outputPath, byteSize: result.size,
          },
        });
      }

      await this.jobManager.markCompleted(jobId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Video preview generation failed';
      await this.jobManager.markFailed(jobId, msg);
    }
  }

  /** Extract a single frame from a video file using ffmpeg. Returns JPEG buffer. */
  private async extractVideoFrame(videoPath: string): Promise<Buffer | null> {
    try {
      // -ss before -i enables fast keyframe seeking
      const { stdout } = await execFileAsync('ffmpeg', [
        '-ss', '1',            // Seek to 1 second (before -i for fast seeking)
        '-i', videoPath,
        '-vframes', '1',       // Extract 1 frame
        '-f', 'image2pipe',    // Output to pipe
        '-vcodec', 'mjpeg',    // JPEG encoding
        '-q:v', '2',           // High quality
        '-y',                  // Non-interactive
        'pipe:1',
      ], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
      return stdout.length > 0 ? stdout : null;
    } catch {
      // Retry at frame 0 for very short videos or files where seeking fails
      try {
        const { stdout } = await execFileAsync('ffmpeg', [
          '-i', videoPath,
          '-vframes', '1',
          '-f', 'image2pipe',
          '-vcodec', 'mjpeg',
          '-q:v', '2',
          '-y',
          'pipe:1',
        ], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
        return stdout.length > 0 ? stdout : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Probe video file for duration + dimensions via ffprobe and persist
   * the result to the on-disk JSON (so it survives reindexing) and the
   * mirrored DB column.
   */
  private async probeVideoMetadata(fileId: string, videoPath: string): Promise<void> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath,
      ], { timeout: 15000 });

      const probe = JSON.parse(stdout);
      const videoStream = probe.streams?.find((s: any) => s.codec_type === 'video');
      const duration = probe.format?.duration ? parseFloat(probe.format.duration) : null;
      const width = videoStream?.width ?? null;
      const height = videoStream?.height ?? null;

      const fields: Record<string, unknown> = {};
      if (duration !== null && !isNaN(duration)) fields.duration = duration;
      if (width !== null) fields.width = width;
      if (height !== null) fields.height = height;
      if (Object.keys(fields).length === 0) return;

      const file = await this.fileRepo.findById(fileId);
      if (!file) return;
      const root = await this.rootRepo.findById(file.archiveRootId);
      if (!root) return;
      const metaRoot = metaRootForArchive(file.archiveRootId, root.rootPath, 'local');
      const { item } = await this.archiveMeta.updateItem(
        metaRoot,
        file.path,
        { name: file.name, hash: file.hash ?? undefined, createdAt: file.fileCreatedAt, modifiedAt: file.fileModifiedAt },
        { fields },
      );
      await this.fileRepo.update(fileId, { meta: item as unknown as object });
    } catch {
      // Non-fatal: metadata probing failure shouldn't block thumbnail generation
    }
  }

  /**
   * Generate previews for all images and videos in an archive root
   * that don't have cached previews yet.
   * Works for both LOCAL_FILESYSTEM and DROPBOX (when files are available via desktop sync).
   */
  async generateForArchiveRoot(archiveRootId: string): Promise<{ generated: number; skipped: number; failed: number }> {
    const root = await this.rootRepo.findById(archiveRootId);
    if (!root) throw new Error(`Archive root ${archiveRootId} not found`);

    const jobId = await this.jobManager.enqueue({
      type: 'preview-batch',
      metadata: { archiveRootId },
    });

    await this.jobManager.markRunning(jobId);

    // Find all image and video files without cached THUMBNAIL previews
    const filesWithoutPreviews = await db.file.findMany({
      where: {
        archiveRootId,
        status: 'INDEXED',
        OR: [
          { mimeType: { startsWith: 'image/' } },
          { mimeType: { startsWith: 'video/' } },
        ],
        previews: { none: { size: 'THUMBNAIL' } },
      },
      select: { id: true },
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const { id } of filesWithoutPreviews) {
      try {
        await this.generatePreviews(id);
        generated++;
      } catch {
        failed++;
      }

      const total = filesWithoutPreviews.length;
      const done = generated + skipped + failed;
      await this.jobManager.updateProgress(jobId, done / total);
    }

    if (failed > 0 && generated === 0) {
      await this.jobManager.markFailed(jobId, `All ${failed} preview generations failed`);
    } else {
      await this.jobManager.markCompleted(jobId);
    }

    return { generated, skipped, failed };
  }
}
