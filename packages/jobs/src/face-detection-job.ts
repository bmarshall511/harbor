/**
 * Face detection background job.
 *
 * Scans image files for faces using the configured AI face-detection
 * provider, stores Face records with bounding boxes, and attempts to
 * link detected faces to known Person records via name matching
 * against the file's `meta.fields.people` array.
 *
 * The job can run in two modes:
 *   1. Single file — triggered when a file is first indexed or when
 *      an admin clicks "Detect faces" on a specific file.
 *   2. Batch — scans all unprocessed image files in an archive root.
 *
 * Flow:
 *   1. Read the file's image data (from disk or offline cache)
 *   2. Call the face detection provider (GPT-4o vision or local ONNX)
 *   3. For each detected face:
 *      a. Create a Face record (bounding box, confidence)
 *      b. Try to match to an existing Person via people metadata
 *      c. If no match and the face confidence is high, create an
 *         unconfirmed Person record for admin review
 *   4. Update the BackgroundJob status
 */

import { db } from '@harbor/database';
import { AiService, FaceDetectionProvider } from '@harbor/ai';
import { JobManager } from './job-manager';
import type { FaceDetectionResult } from '@harbor/types';

interface FaceDetectionJobOptions {
  fileId?: string;
  archiveRootId?: string;
  userId?: string;
  limit?: number;
  /** OpenAI API key from the encrypted secrets store. */
  openAiApiKey?: string;
}

export class FaceDetectionJob {
  private jobManager = new JobManager();

  /**
   * Run face detection on a single file or batch of files.
   */
  async run(options: FaceDetectionJobOptions): Promise<{ processed: number; facesFound: number }> {
    const jobId = await this.jobManager.enqueue({
      type: 'face_detect',
      entityType: options.fileId ? 'FILE' : undefined,
      entityId: options.fileId,
      metadata: { archiveRootId: options.archiveRootId },
    });

    try {
      await this.jobManager.markRunning(jobId);

      // Get the AI provider
      const aiService = await this.buildAiService(options.openAiApiKey);
      if (!aiService) {
        await this.jobManager.markFailed(jobId, 'Face detection is not configured. Enable AI and set an OpenAI API key in settings.');
        return { processed: 0, facesFound: 0 };
      }

      // Get files to process
      const files = options.fileId
        ? await db.file.findMany({
            where: { id: options.fileId, status: 'INDEXED', mimeType: { startsWith: 'image/' } },
            select: { id: true, archiveRootId: true, path: true, mimeType: true, meta: true },
          })
        : await db.file.findMany({
            where: {
              ...(options.archiveRootId ? { archiveRootId: options.archiveRootId } : {}),
              status: 'INDEXED',
              mimeType: { startsWith: 'image/' },
              // Only files that haven't been face-scanned yet
              faces: { none: {} },
            },
            select: { id: true, archiveRootId: true, path: true, mimeType: true, meta: true },
            take: options.limit ?? 100,
            orderBy: { indexedAt: 'desc' },
          });

      let processed = 0;
      let facesFound = 0;

      for (const file of files) {
        try {
          const faces = await this.detectFacesForFile(aiService, file);
          facesFound += faces;
          processed++;

          // Update progress
          await this.jobManager.updateProgress(jobId, processed / files.length);
        } catch (err) {
          console.error(`[FaceDetect] Failed for file ${file.id}:`, err);
        }
      }

      await this.jobManager.markCompleted(jobId);
      return { processed, facesFound };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Face detection failed';
      await this.jobManager.markFailed(jobId, message);
      return { processed: 0, facesFound: 0 };
    }
  }

  private async detectFacesForFile(
    aiService: AiService,
    file: { id: string; archiveRootId: string; path: string; mimeType: string | null; meta: unknown },
  ): Promise<number> {
    // Read the image data
    const imageData = await this.readFileImage(file);
    if (!imageData) return 0;

    // Run face detection
    const result = await aiService.run({
      purpose: 'face_detection',
      input: { type: 'image', data: imageData, mimeType: file.mimeType ?? 'image/jpeg' },
      entityType: 'FILE',
      entityId: file.id,
    });

    if (result.status !== 'COMPLETED' || !result.result) return 0;

    const detection = result.result as FaceDetectionResult;
    if (!detection.faces || detection.faces.length === 0) return 0;

    // Get existing people names from metadata for matching
    const meta = file.meta as { fields?: { people?: Array<{ name: string; kind: string; id?: string }> } } | null;
    const metaPeople = meta?.fields?.people ?? [];

    // Get all known Person records for matching
    const knownPersons = await db.person.findMany({
      where: { name: { not: null } },
      select: { id: true, name: true },
    });
    const personsByName = new Map(knownPersons.map((p) => [p.name!.toLowerCase(), p.id]));

    // Create Face records
    for (const face of detection.faces) {
      // Try to match to a known person
      let personId: string | null = null;

      // First try: match via metadata people names
      for (const person of metaPeople) {
        const match = personsByName.get(person.name.toLowerCase());
        if (match) {
          personId = match;
          break;
        }
      }

      // Create the face record
      await db.face.create({
        data: {
          fileId: file.id,
          personId,
          boundingBox: face.boundingBox,
          confidence: face.confidence,
        },
      });

      // If high confidence and no match, create an unconfirmed Person
      // for admin review (only if we don't have too many unknowns)
      if (!personId && face.confidence > 0.8) {
        const unknownCount = await db.person.count({ where: { name: null, isConfirmed: false } });
        if (unknownCount < 500) {
          const newPerson = await db.person.create({
            data: { isConfirmed: false },
          });
          // Link this face to the new person
          await db.face.update({
            where: { id: (await db.face.findFirst({ where: { fileId: file.id, personId: null }, orderBy: { createdAt: 'desc' } }))!.id },
            data: { personId: newPerson.id },
          });
        }
      }
    }

    return detection.faces.length;
  }

  private async readFileImage(file: { id: string; archiveRootId: string; path: string }): Promise<Buffer | null> {
    try {
      const root = await db.archiveRoot.findUnique({ where: { id: file.archiveRootId } });
      if (!root) return null;

      if (root.providerType === 'LOCAL_FILESYSTEM') {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const fullPath = path.resolve(root.rootPath, file.path);
        return await fs.readFile(fullPath);
      }

      // Dropbox: check offline cache
      const { SettingsRepository } = await import('@harbor/database');
      const settingsRepo = new SettingsRepository();
      const cacheDir = await settingsRepo.get('preview.cacheDir');
      const pathMod = await import('node:path');
      const fsMod = await import('node:fs/promises');
      const cachePath = pathMod.join(cacheDir, 'offline', file.id);
      try {
        return await fsMod.readFile(cachePath);
      } catch {
        // Not cached — skip this file for face detection
        return null;
      }
    } catch {
      return null;
    }
  }

  private async buildAiService(openAiApiKey?: string): Promise<AiService | null> {
    const { SettingsRepository } = await import('@harbor/database');
    const settingsRepo = new SettingsRepository();

    const aiEnabled = await settingsRepo.get('ai.enabled');
    const faceEnabled = await settingsRepo.get('ai.faceRecognition');
    if (aiEnabled !== 'true' || faceEnabled !== 'true') return null;

    const apiKey = openAiApiKey;
    if (!apiKey) return null;

    const service = new AiService();
    const provider = new FaceDetectionProvider({ apiKey });
    service.registerProvider(provider);
    service.setRouting('face_detection', provider.name);

    return service;
  }
}
