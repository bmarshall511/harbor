/**
 * Face detection provider — supports OpenAI, Anthropic, and Gemini
 * vision models for detecting faces in images.
 *
 * Returns bounding boxes as normalized 0-1 coordinates + confidence.
 * The backend is selected via the `backend` config option.
 */

import type { AiProvider, AiPurpose, AiJobInput, FaceDetectionResult } from '@harbor/types';

interface FaceDetectionProviderConfig {
  backend: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  model?: string;
}

const FACE_PROMPT = `You are a face detection system. Analyze the image and identify all visible human faces.

For each face, provide:
- x: left edge as fraction of image width (0.0 to 1.0)
- y: top edge as fraction of image height (0.0 to 1.0)
- width: face width as fraction of image width
- height: face height as fraction of image height
- confidence: your confidence that this is a human face (0.0 to 1.0)

Respond ONLY with valid JSON in this exact format:
{"faces":[{"x":0.1,"y":0.2,"width":0.15,"height":0.2,"confidence":0.95}]}

If no faces are found, respond with: {"faces":[]}
Do not include any text outside the JSON object.`;

const USER_PROMPT = 'Detect all human faces in this image. Return JSON with bounding boxes.';

export class FaceDetectionProvider implements AiProvider {
  readonly name: string;
  readonly supportedPurposes: AiPurpose[] = ['face_detection'];
  private config: FaceDetectionProviderConfig;

  constructor(config: FaceDetectionProviderConfig) {
    this.config = config;
    this.name = `face-detection-${config.backend}`;
  }

  async detectFaces(input: AiJobInput): Promise<FaceDetectionResult> {
    if (input.type !== 'image') return { faces: [] };

    const base64 = input.data.toString('base64');
    const dataUrl = `data:${input.mimeType};base64,${base64}`;

    try {
      let raw: string;

      switch (this.config.backend) {
        case 'openai':
          raw = await this.callOpenAI(dataUrl);
          break;
        case 'anthropic':
          raw = await this.callAnthropic(base64, input.mimeType);
          break;
        case 'gemini':
          raw = await this.callGemini(base64, input.mimeType);
          break;
        default:
          return { faces: [] };
      }

      return this.parseResponse(raw);
    } catch (error) {
      console.error(`[FaceDetection] ${this.config.backend} call failed:`, error);
      return { faces: [] };
    }
  }

  private async callOpenAI(dataUrl: string): Promise<string> {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: this.config.apiKey });
    const model = this.config.model ?? 'gpt-4o';

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: FACE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    });

    return response.choices[0]?.message?.content?.trim() ?? '{"faces":[]}';
  }

  private async callAnthropic(base64: string, mimeType: string): Promise<string> {
    const model = this.config.model ?? 'claude-sonnet-4-20250514';
    const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: FACE_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: USER_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const body = await res.json() as { content: Array<{ type: string; text?: string }> };
    return body.content.find((b) => b.type === 'text')?.text ?? '{"faces":[]}';
  }

  private async callGemini(base64: string, mimeType: string): Promise<string> {
    const model = this.config.model ?? 'gemini-2.0-flash';

    const res = await globalThis.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: FACE_PROMPT + '\n\n' + USER_PROMPT },
                { inlineData: { mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 1000,
            temperature: 0,
          },
        }),
      },
    );

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const body = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text?: string }> } }> };
    return body.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"faces":[]}';
  }

  private parseResponse(raw: string): FaceDetectionResult {
    let jsonStr = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as {
      faces: Array<{ x: number; y: number; width: number; height: number; confidence: number }>;
    };

    return {
      faces: (parsed.faces ?? [])
        .filter((f) =>
          typeof f.x === 'number' &&
          typeof f.y === 'number' &&
          typeof f.width === 'number' &&
          typeof f.height === 'number' &&
          f.confidence > 0.3,
        )
        .map((f) => ({
          boundingBox: {
            x: Math.max(0, Math.min(1, f.x)),
            y: Math.max(0, Math.min(1, f.y)),
            width: Math.max(0, Math.min(1, f.width)),
            height: Math.max(0, Math.min(1, f.height)),
          },
          confidence: f.confidence,
        })),
    };
  }
}
