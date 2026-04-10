import type { AiProvider, AiPurpose, AiJobInput, AiJobResult } from '@harbor/types';
import { AiUsageTracker } from './usage-tracker';

export class AiService {
  private providers = new Map<string, AiProvider>();
  private tracker = new AiUsageTracker();
  private purposeRouting = new Map<AiPurpose, string>();

  registerProvider(provider: AiProvider): void {
    this.providers.set(provider.name, provider);
  }

  setRouting(purpose: AiPurpose, providerName: string): void {
    this.purposeRouting.set(purpose, providerName);
  }

  private getProviderForPurpose(purpose: AiPurpose): AiProvider {
    const routed = this.purposeRouting.get(purpose);
    if (routed) {
      const provider = this.providers.get(routed);
      if (provider) return provider;
    }

    // Fall back to first provider that supports this purpose
    for (const provider of this.providers.values()) {
      if (provider.supportedPurposes.includes(purpose)) return provider;
    }

    throw new Error(`No provider available for purpose: ${purpose}`);
  }

  async run(request: {
    purpose: AiPurpose;
    input: AiJobInput;
    entityType?: 'FILE' | 'FOLDER';
    entityId?: string;
    userId?: string;
    model?: string;
  }): Promise<AiJobResult> {
    const provider = this.getProviderForPurpose(request.purpose);
    const model = request.model ?? 'default';

    const jobId = await this.tracker.createJob({
      userId: request.userId,
      provider: provider.name,
      model,
      purpose: request.purpose,
      entityType: request.entityType,
      entityId: request.entityId,
    });

    const startTime = Date.now();
    await this.tracker.markRunning(jobId);

    try {
      let result: unknown;

      switch (request.purpose) {
        case 'ocr':
        case 'text_extraction':
          if (!provider.ocr) throw new Error(`Provider ${provider.name} doesn't support OCR`);
          result = await provider.ocr(request.input);
          break;
        case 'tagging':
          if (!provider.generateTags) throw new Error(`Provider ${provider.name} doesn't support tagging`);
          result = await provider.generateTags(request.input);
          break;
        case 'title_generation':
        case 'description_generation':
        case 'summarization':
          if (!provider.generateTitle) throw new Error(`Provider ${provider.name} doesn't support title generation`);
          result = await provider.generateTitle(request.input);
          break;
        case 'transcription':
          if (!provider.transcribe) throw new Error(`Provider ${provider.name} doesn't support transcription`);
          result = await provider.transcribe(request.input);
          break;
        case 'face_detection':
        case 'face_clustering':
          if (!provider.detectFaces) throw new Error(`Provider ${provider.name} doesn't support face detection`);
          result = await provider.detectFaces(request.input);
          break;
        case 'embedding':
          if (!provider.generateEmbedding) throw new Error(`Provider ${provider.name} doesn't support embeddings`);
          result = await provider.generateEmbedding(request.input);
          break;
        case 'duplicate_detection':
          throw new Error('Duplicate detection is a pipeline, not a single AI call');
        default:
          throw new Error(`Unknown purpose: ${request.purpose}`);
      }

      const elapsedMs = Date.now() - startTime;
      await this.tracker.markCompleted(jobId, { result });

      return {
        jobId,
        provider: provider.name,
        model,
        purpose: request.purpose,
        status: 'COMPLETED',
        elapsedMs,
        result,
      };
    } catch (error: any) {
      await this.tracker.markFailed(jobId, error.message);
      return {
        jobId,
        provider: provider.name,
        model,
        purpose: request.purpose,
        status: 'FAILED',
        elapsedMs: Date.now() - startTime,
        result: null,
        error: error.message,
      };
    }
  }
}
