import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  AiPurpose,
  AiJobInput,
  TaggingResult,
  TitleResult,
  OcrResult,
} from '@harbor/types';

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly supportedPurposes: AiPurpose[] = [
    'tagging',
    'title_generation',
    'description_generation',
    'summarization',
    'ocr',
  ];

  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async ocr(input: AiJobInput): Promise<OcrResult> {
    if (input.type !== 'image') {
      throw new Error('OCR requires image input');
    }

    const base64 = input.data.toString('base64');
    const mediaType = input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: 'Extract all text from this image. Return only the extracted text, preserving layout.',
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return { text, confidence: 0.9 };
  }

  async generateTags(input: AiJobInput): Promise<TaggingResult> {
    let content: Anthropic.MessageCreateParams['messages'][0]['content'];

    if (input.type === 'image') {
      const base64 = input.data.toString('base64');
      const mediaType = input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: 'Analyze this image and return a JSON object with a "tags" array. Each tag should have "name" (lowercase), "confidence" (0-1), and optional "category" (people, location, object, event, mood, color, subject). Return only valid JSON.',
        },
      ];
    } else {
      content = `Analyze this text and return a JSON object with a "tags" array. Each tag: "name" (lowercase), "confidence" (0-1), optional "category".\n\nText: ${input.type === 'text' ? input.data : ''}`;
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    try {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { tags: parsed.tags ?? [] };
      }
    } catch { /* parse failure */ }

    return { tags: [] };
  }

  async generateTitle(input: AiJobInput): Promise<TitleResult> {
    let content: Anthropic.MessageCreateParams['messages'][0]['content'];

    if (input.type === 'image') {
      const base64 = input.data.toString('base64');
      const mediaType = input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: 'Generate a concise, descriptive title and a one-sentence description for this image. Return a JSON object with "title" and "description" fields only.',
        },
      ];
    } else {
      content = `Generate a concise title and one-sentence description. Return JSON with "title" and "description".\n\nContent: ${input.type === 'text' ? input.data : ''}`;
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    });

    try {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { title: parsed.title ?? 'Untitled', description: parsed.description };
      }
    } catch { /* parse failure */ }

    return { title: 'Untitled' };
  }
}
