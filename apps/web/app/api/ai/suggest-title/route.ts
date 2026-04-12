import { NextResponse } from 'next/server';
import { FileRepository, db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { getSetting } from '@/lib/settings';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const fileRepo = new FileRepository();

/**
 * POST /api/ai/suggest-title
 *
 * Analyzes an image file and returns multiple title suggestions.
 * Uses the configured AI model with admin-defined tone, length,
 * and archive context settings.
 *
 * Body: { fileId: string }
 * Response: { suggestions: string[], jobId, tokens, cost, elapsed }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { fileId } = await request.json();
    if (!fileId) return NextResponse.json({ message: 'fileId is required' }, { status: 400 });

    // ── Check AI is enabled ───────────────────────────────────
    const aiEnabled = await getSetting('ai.enabled');
    if (aiEnabled !== 'true') {
      return NextResponse.json({ message: 'AI features are disabled. Enable them in Settings > AI Features.' }, { status: 400 });
    }

    const titleEnabled = await getSetting('ai.title.enabled');
    if (titleEnabled !== 'true') {
      return NextResponse.json({ message: 'AI title suggestions are disabled in settings.' }, { status: 400 });
    }

    // ── Load file ─────────────────────────────────────────────
    const file = await fileRepo.findById(fileId);
    if (!file) return NextResponse.json({ message: 'File not found' }, { status: 404 });
    if (!file.mimeType?.startsWith('image/')) {
      return NextResponse.json({ message: 'AI title suggestions are only available for image files.' }, { status: 400 });
    }

    // ── Load settings ─────────────────────────────────────────
    const model = await getSetting('ai.defaultModel');
    const tone = await getSetting('ai.title.tone');
    const maxLength = await getSetting('ai.title.maxLength');
    const suggestionCount = await getSetting('ai.title.suggestionCount');
    const systemContext = await getSetting('ai.title.systemContext');

    // ── Determine provider from model ─────────────────────────
    const isAnthropic = model.startsWith('claude');
    const provider = isAnthropic ? 'anthropic' : 'openai';
    const apiKey = await getSecret(isAnthropic ? 'anthropic.apiKey' : 'openai.apiKey');

    if (!apiKey) {
      return NextResponse.json({
        message: `No API key configured for ${provider}. Add it in Settings > AI Features.`,
      }, { status: 400 });
    }

    // ── Read image data ───────────────────────────────────────
    const root = await db.archiveRoot.findUnique({ where: { id: file.archiveRootId } });
    if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

    let imageBuffer: Buffer | null = null;

    if (root.providerType === 'LOCAL_FILESYSTEM') {
      const fullPath = path.resolve(root.rootPath, file.path);
      try {
        imageBuffer = Buffer.from(await fs.readFile(fullPath));
      } catch {
        return NextResponse.json({ message: 'Could not read image file from disk.' }, { status: 404 });
      }
    } else {
      // Dropbox: try offline cache
      const cacheDir = await getSetting('preview.cacheDir');
      const cachePath = path.join(cacheDir, 'offline', fileId);
      try {
        imageBuffer = Buffer.from(await fs.readFile(cachePath));
      } catch {
        return NextResponse.json({
          message: 'Image not available offline. Make it available offline first, then try again.',
        }, { status: 400 });
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return NextResponse.json({ message: 'Image file is empty.' }, { status: 400 });
    }

    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${file.mimeType};base64,${base64}`;

    // ── Build prompt ──────────────────────────────────────────
    const prompt = buildPrompt({
      tone,
      maxLength: parseInt(maxLength, 10) || 80,
      count: parseInt(suggestionCount, 10) || 4,
      systemContext,
      fileName: file.name,
    });

    // ── Create tracking job ───────────────────────────────────
    const job = await db.aiJob.create({
      data: {
        userId: auth.userId,
        provider,
        model,
        purpose: 'title_generation',
        entityType: 'FILE',
        entityId: fileId,
        status: 'QUEUED',
      },
    });
    const jobId = job.id;
    await db.aiJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });

    // ── Cost table ─────────────────────────────────────────────
    const costTable: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'claude-sonnet-4-20250514': { input: 3, output: 15 },
    };
    const rates = costTable[model] ?? { input: 2.5, output: 10 };

    // ── Call AI provider ──────────────────────────────────────
    let suggestions: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      if (isAnthropic) {
        const result = await callAnthropic(apiKey, model, prompt, dataUrl, file.mimeType!);
        suggestions = result.suggestions;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } else {
        const result = await callOpenAI(apiKey, model, prompt, dataUrl);
        suggestions = result.suggestions;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI provider error';
      await db.aiJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      }).catch(() => {});
      return NextResponse.json({ message: `AI error: ${message}` }, { status: 502 });
    }

    // ── Record completion ─────────────────────────────────────
    const startedAt = job.createdAt.getTime();
    const elapsedMs = Date.now() - startedAt;
    await db.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        inputTokens,
        outputTokens,
        elapsedMs,
        estimatedCost: (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000,
        result: { suggestions } as any,
      },
    }).catch(() => {});

    // Calculate cost for display
    const cost = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;

    return NextResponse.json({
      suggestions,
      jobId,
      tokens: { input: inputTokens, output: outputTokens },
      cost,
      model,
      provider,
    });
  } catch (err) {
    console.error('[AI/SuggestTitle] Unexpected error:', err);
    return NextResponse.json({
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }, { status: 500 });
  }
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(opts: {
  tone: string;
  maxLength: number;
  count: number;
  systemContext: string;
  fileName: string;
}): string {
  const parts = [
    'You are analyzing an image to suggest titles for a media archive.',
  ];

  if (opts.systemContext.trim()) {
    parts.push(`\nArchive context: ${opts.systemContext.trim()}`);
  }

  parts.push(`\nThe file is named "${opts.fileName}".`);
  parts.push(`\nGenerate exactly ${opts.count} title suggestions for this image.`);
  parts.push(`Each title should be ${opts.tone} in tone and no longer than ${opts.maxLength} characters.`);
  parts.push('Titles should be concise, descriptive, and suitable for an archive catalog.');
  parts.push('Do NOT include quotes around the titles.');
  parts.push('\nReturn ONLY a valid JSON object with a single key "titles" containing an array of strings. No other text.');

  return parts.join('\n');
}

// ─── OpenAI Call (raw fetch, no SDK dependency) ─────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  dataUrl: string,
): Promise<{ suggestions: string[]; inputTokens: number; outputTokens: number }> {
  const res = await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `OpenAI ${res.status}` } }));
    throw new Error(err.error?.message ?? `OpenAI request failed (${res.status})`);
  }

  const response = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw);
  const suggestions = Array.isArray(parsed.titles)
    ? parsed.titles.filter((t: unknown): t is string => typeof t === 'string')
    : [];

  return {
    suggestions,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

// ─── Anthropic Call (raw fetch, no SDK dependency) ───────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  dataUrl: string,
  mimeType: string,
): Promise<{ suggestions: string[]; inputTokens: number; outputTokens: number }> {
  const base64 = dataUrl.split(',')[1];
  const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

  const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `Anthropic ${res.status}` } }));
    throw new Error(err.error?.message ?? `Anthropic request failed (${res.status})`);
  }

  const response = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
  const raw = textBlock?.text ?? '{}';

  // Handle markdown code blocks that some models wrap around JSON
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);
  const suggestions = Array.isArray(parsed.titles)
    ? parsed.titles.filter((t: unknown): t is string => typeof t === 'string')
    : [];

  return {
    suggestions,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
