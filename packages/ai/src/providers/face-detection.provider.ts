/**
 * Face detection provider — uses OpenAI's GPT-4o vision model to
 * detect faces in images and return bounding boxes + confidence.
 *
 * This is the "works now" implementation that leverages the existing
 * OpenAI provider configuration. For high-volume or cost-sensitive
 * deployments, swap in a local ONNX-based detector (e.g. BlazeFace,
 * RetinaFace) that runs on-device without API costs.
 *
 * The provider:
 *   1. Accepts an image buffer (via AiJobInput)
 *   2. Sends it to GPT-4o with a structured prompt asking for face
 *      bounding boxes as normalized 0-1 coordinates
 *   3. Parses the response into FaceDetectionResult format
 *
 * No embeddings are generated here — those would need a dedicated
 * face embedding model (FaceNet, ArcFace) or a separate API call.
 * The `embedding` field on Face records is populated later during
 * clustering if a suitable model is configured.
 */

import type { AiProvider, AiPurpose, AiJobInput, FaceDetectionResult } from '@harbor/types';
import OpenAI from 'openai';

interface FaceDetectionProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class FaceDetectionProvider implements AiProvider {
  readonly name = 'face-detection-openai';
  readonly supportedPurposes: AiPurpose[] = ['face_detection'];
  private client: OpenAI;
  private model: string;

  constructor(config: FaceDetectionProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model ?? 'gpt-4o';
  }

  async detectFaces(input: AiJobInput): Promise<FaceDetectionResult> {
    if (input.type !== 'image') {
      return { faces: [] };
    }

    const base64 = input.data.toString('base64');
    const dataUrl = `data:${input.mimeType};base64,${base64}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a face detection system. Analyze the image and identify all visible human faces.

For each face, provide:
- x: left edge as fraction of image width (0.0 to 1.0)
- y: top edge as fraction of image height (0.0 to 1.0)
- width: face width as fraction of image width
- height: face height as fraction of image height
- confidence: your confidence that this is a human face (0.0 to 1.0)

Respond ONLY with valid JSON in this exact format:
{"faces":[{"x":0.1,"y":0.2,"width":0.15,"height":0.2,"confidence":0.95}]}

If no faces are found, respond with: {"faces":[]}
Do not include any text outside the JSON object.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              },
              {
                type: 'text',
                text: 'Detect all human faces in this image. Return JSON with bounding boxes.',
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '{"faces":[]}';

      // Parse the JSON response — GPT sometimes wraps in markdown code blocks
      let jsonStr = content;
      const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

      const parsed = JSON.parse(jsonStr) as {
        faces: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          confidence: number;
        }>;
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
    } catch (error) {
      console.error('[FaceDetection] OpenAI vision call failed:', error);
      return { faces: [] };
    }
  }
}
