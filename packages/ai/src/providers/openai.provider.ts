import OpenAI from 'openai';
import type {
  AiProvider,
  AiPurpose,
  AiJobInput,
  OcrResult,
  TaggingResult,
  TitleResult,
  TranscriptionResult,
  EmbeddingResult,
} from '@harbor/types';

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly supportedPurposes: AiPurpose[] = [
    'ocr',
    'text_extraction',
    'tagging',
    'title_generation',
    'transcription',
    'embedding',
  ];

  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async ocr(input: AiJobInput): Promise<OcrResult> {
    if (input.type !== 'image') {
      throw new Error('OCR requires image input');
    }

    const base64 = input.data.toString('base64');
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all text from this image. Return only the extracted text, preserving the layout as much as possible.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:${input.mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_tokens: 4096,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      confidence: 0.9,
    };
  }

  async generateTags(input: AiJobInput): Promise<TaggingResult> {
    let content: any[];

    if (input.type === 'image') {
      const base64 = input.data.toString('base64');
      content = [
        {
          type: 'text',
          text: 'Analyze this image and return a JSON array of descriptive tags. Each tag should have a "name" (lowercase), "confidence" (0-1), and optional "category" (one of: people, location, object, event, mood, color, subject). Return only valid JSON.',
        },
        {
          type: 'image_url',
          image_url: { url: `data:${input.mimeType};base64,${base64}` },
        },
      ];
    } else {
      content = [
        {
          type: 'text',
          text: `Analyze this text and return a JSON array of descriptive tags. Each tag should have a "name" (lowercase), "confidence" (0-1), and optional "category".\n\nText: ${input.type === 'text' ? input.data : ''}`,
        },
      ];
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    });

    try {
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
      return { tags: parsed.tags ?? [] };
    } catch {
      return { tags: [] };
    }
  }

  async generateTitle(input: AiJobInput): Promise<TitleResult> {
    let content: any[];

    if (input.type === 'image') {
      const base64 = input.data.toString('base64');
      content = [
        {
          type: 'text',
          text: 'Generate a concise, descriptive title and a one-sentence description for this image. Return JSON with "title" and "description" fields.',
        },
        {
          type: 'image_url',
          image_url: { url: `data:${input.mimeType};base64,${base64}` },
        },
      ];
    } else {
      content = [
        {
          type: 'text',
          text: `Generate a concise, descriptive title and a one-sentence description for this content. Return JSON with "title" and "description" fields.\n\nContent: ${input.type === 'text' ? input.data : ''}`,
        },
      ];
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      max_tokens: 256,
    });

    try {
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
      return { title: parsed.title ?? 'Untitled', description: parsed.description };
    } catch {
      return { title: 'Untitled' };
    }
  }

  async transcribe(input: AiJobInput): Promise<TranscriptionResult> {
    if (input.type !== 'audio' && input.type !== 'file_path') {
      throw new Error('Transcription requires audio input');
    }

    let file: any;
    if (input.type === 'audio') {
      file = new File([new Uint8Array(input.data)], 'audio.mp3', { type: input.mimeType });
    } else {
      const fs = await import('node:fs');
      file = fs.createReadStream(input.path);
    }

    const response = await this.client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'verbose_json',
    });

    return {
      text: response.text,
      segments: (response as any).segments?.map((s: any) => ({
        text: s.text,
        start: s.start,
        end: s.end,
      })),
      language: (response as any).language,
    };
  }

  async generateEmbedding(input: AiJobInput): Promise<EmbeddingResult> {
    const text = input.type === 'text' ? input.data : '';

    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return {
      embedding: response.data[0]?.embedding ?? [],
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };
  }
}
