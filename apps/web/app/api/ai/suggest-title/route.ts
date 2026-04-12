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
    const { fileId, tone: toneOverride } = await request.json();
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
    const tone = toneOverride || await getSetting('ai.title.tone');
    const maxLength = await getSetting('ai.title.maxLength');
    const suggestionCount = await getSetting('ai.title.suggestionCount');
    const systemContext = await getSetting('ai.title.systemContext');

    const descMaxLength = await getSetting('ai.description.maxLength');
    const tagCount = await getSetting('ai.tags.count');

    // ── Determine provider from model ─────────────────────────
    const isAnthropic = model.startsWith('claude');
    const isGemini = model.startsWith('gemini');
    const provider = isGemini ? 'gemini' : isAnthropic ? 'anthropic' : 'openai';
    const secretKey = isGemini ? 'gemini.apiKey' : isAnthropic ? 'anthropic.apiKey' : 'openai.apiKey';
    const apiKey = await getSecret(secretKey);

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
      // Dropbox: try offline cache first, then download via API
      const cacheDir = await getSetting('preview.cacheDir');
      const cachePath = path.join(cacheDir, 'offline', fileId);
      try {
        imageBuffer = Buffer.from(await fs.readFile(cachePath));
      } catch {
        // Not cached — auto-download via the cache endpoint
        try {
          const cacheRes = await fetch(new URL(`/api/files/${fileId}/cache`, request.url), {
            method: 'POST',
            headers: { cookie: request.headers.get('cookie') ?? '' },
          });
          if (cacheRes.ok) {
            // Try reading again after caching
            imageBuffer = Buffer.from(await fs.readFile(cachePath));
          }
        } catch { /* fall through */ }

        if (!imageBuffer) {
          return NextResponse.json({
            message: 'Could not download image from Dropbox. Try making it available offline first.',
          }, { status: 400 });
        }
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
      descMaxLength: parseInt(descMaxLength, 10) || 200,
      tagCount: parseInt(tagCount, 10) || 8,
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
      'gemini-2.5-flash': { input: 0.15, output: 0.6 },
      'gemini-2.5-pro': { input: 1.25, output: 5 },
    };
    const rates = costTable[model] ?? { input: 2.5, output: 10 };

    // ── Call AI provider ──────────────────────────────────────
    let suggestions: string[] = [];
    let parsedDescriptions: string[] = [];
    let parsedTags: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      let result;
      if (isGemini) {
        result = await callGemini(apiKey, model, prompt, dataUrl, file.mimeType!);
      } else if (isAnthropic) {
        result = await callAnthropic(apiKey, model, prompt, dataUrl, file.mimeType!);
      } else {
        result = await callOpenAI(apiKey, model, prompt, dataUrl);
      }
      suggestions = result.suggestions;
      parsedDescriptions = result.descriptions ?? [];
      parsedTags = result.tags ?? [];
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch (err) {
      const technicalError = err instanceof Error ? err.message : 'AI provider error';
      console.error(`[AI/SuggestTitle] Provider error for file ${fileId}:`, technicalError);
      await db.aiJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: technicalError, completedAt: new Date() },
      }).catch(() => {});
      return NextResponse.json({
        message: `AI error: ${technicalError}`,
      }, { status: 502 });
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
      descriptions: suggestions.length > 0 ? parsedDescriptions : [],
      tags: suggestions.length > 0 ? parsedTags : [],
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

// ─── Response Parser ─────────────────────────────────────────────────────────

/**
 * Robustly parse AI title suggestions from various response formats.
 * Handles: JSON {"titles": [...]}, JSON arrays [...], numbered lists,
 * bullet lists, and plain text lines. Falls back gracefully when the
 * model returns natural language instead of JSON.
 */
function parseAiResponse(raw: string): { titles: string[]; descriptions: string[]; tags: string[] } {
  const cleaned = raw.trim();

  // Try JSON parsing first
  try {
    // Handle markdown code blocks
    let json = cleaned;
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return { titles: parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0), descriptions: [], tags: [] };
    const titles = (parsed.titles ?? parsed.suggestions ?? []).filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0);
    // Handle both "descriptions" (array) and "description" (single string)
    let descriptions: string[] = [];
    if (Array.isArray(parsed.descriptions)) descriptions = parsed.descriptions.filter((d: unknown): d is string => typeof d === 'string' && d.trim().length > 0);
    else if (typeof parsed.description === 'string') descriptions = [parsed.description];
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string') : [];
    if (titles.length > 0) return { titles, descriptions, tags };
  } catch { /* not JSON, try other formats */ }

  // Try line-by-line extraction (numbered lists, bullet lists)
  const lines = cleaned.split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter((l) => l.length > 3 && l.length < 200 && !l.startsWith('{') && !l.startsWith('I '));

  if (lines.length >= 2) return { titles: lines, descriptions: [], tags: [] };

  return { titles: [], descriptions: [], tags: [] };
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(opts: {
  tone: string;
  maxLength: number;
  count: number;
  descMaxLength?: number;
  tagCount?: number;
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
  parts.push('All titles MUST be in Title Case (capitalize the first letter of each major word).');
  parts.push('Do NOT include quotes around the titles.');
  parts.push('\nAlso generate:');
  parts.push(`- 3 different description options for the image (each 2-3 sentences, same tone, max ${opts.descMaxLength ?? 200} characters each)`);
  parts.push(`- ${opts.tagCount ?? 8} descriptive tags in Title Case (capitalize each word)`);
  parts.push('\nReturn ONLY a valid JSON object with keys: "titles" (array of strings), "descriptions" (array of strings), "tags" (array of strings). No other text.');

  return parts.join('\n');
}

// ─── OpenAI Call (raw fetch, no SDK dependency) ─────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  dataUrl: string,
): Promise<{ suggestions: string[]; descriptions: string[]; tags: string[]; inputTokens: number; outputTokens: number }> {
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
  const aiResult = parseAiResponse(raw);

  return {
    suggestions: aiResult.titles,
    descriptions: aiResult.descriptions,
    tags: aiResult.tags,
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
): Promise<{ suggestions: string[]; descriptions: string[]; tags: string[]; inputTokens: number; outputTokens: number }> {
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

  const aiResult = parseAiResponse(jsonStr);

  return {
    suggestions: aiResult.titles,
    descriptions: aiResult.descriptions,
    tags: aiResult.tags,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

// ─── Gemini Call (raw fetch) ─────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  dataUrl: string,
  mimeType: string,
): Promise<{ suggestions: string[]; descriptions: string[]; tags: string[]; inputTokens: number; outputTokens: number }> {
  const base64 = dataUrl.split(',')[1];

  const res = await globalThis.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 512,
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `Gemini ${res.status}` } }));
    throw new Error(err.error?.message ?? `Gemini request failed (${res.status})`);
  }

  const response = await res.json() as {
    candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const aiResult = parseAiResponse(raw);

  return {
    suggestions: aiResult.titles,
    descriptions: aiResult.descriptions,
    tags: aiResult.tags,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
