import { NextResponse } from 'next/server';
import { FaceDetectionJob } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';

/**
 * POST /api/face-detection — Trigger face detection.
 *
 * Body:
 *   { fileId?: string, archiveRootId?: string, limit?: number }
 *
 * If `fileId` is provided, scans that single file.
 * If `archiveRootId` is provided, scans unprocessed images in that root.
 * Otherwise scans all unprocessed images (up to `limit`, default 100).
 *
 * Admin only — face detection uses AI credits.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.ai', 'access');
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const { fileId, archiveRootId, limit } = body;

  const [openAiApiKey, anthropicApiKey, geminiApiKey] = await Promise.all([
    getSecret('openai.apiKey'),
    getSecret('anthropic.apiKey'),
    getSecret('gemini.apiKey'),
  ]);

  const job = new FaceDetectionJob();
  const result = await job.run({
    fileId,
    archiveRootId,
    userId: auth.userId,
    limit: limit ?? 100,
    openAiApiKey: openAiApiKey ?? undefined,
    anthropicApiKey: anthropicApiKey ?? undefined,
    geminiApiKey: geminiApiKey ?? undefined,
  });

  return NextResponse.json(result);
}
