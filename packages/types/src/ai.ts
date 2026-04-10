// =============================================================================
// AI Provider Type Contracts
// =============================================================================

export type AiJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type AiPurpose =
  | 'ocr'
  | 'text_extraction'
  | 'tagging'
  | 'title_generation'
  | 'description_generation'
  | 'transcription'
  | 'face_detection'
  | 'face_clustering'
  | 'embedding'
  | 'duplicate_detection'
  | 'summarization';

export interface AiProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface AiJobRequest {
  purpose: AiPurpose;
  entityType?: 'FILE' | 'FOLDER';
  entityId?: string;
  input: AiJobInput;
  options?: Record<string, unknown>;
}

export type AiJobInput =
  | { type: 'image'; data: Buffer; mimeType: string }
  | { type: 'text'; data: string }
  | { type: 'audio'; data: Buffer; mimeType: string }
  | { type: 'file_path'; path: string; mimeType: string };

export interface AiJobResult {
  jobId: string;
  provider: string;
  model: string;
  purpose: AiPurpose;
  status: AiJobStatus;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs: number;
  estimatedCost?: number;
  result: unknown;
  error?: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  blocks?: Array<{
    text: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
}

export interface TaggingResult {
  tags: Array<{
    name: string;
    confidence: number;
    category?: string;
  }>;
}

export interface TitleResult {
  title: string;
  description?: string;
}

export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
  language?: string;
}

export interface FaceDetectionResult {
  faces: Array<{
    boundingBox: { x: number; y: number; width: number; height: number };
    confidence: number;
    embedding?: number[];
  }>;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface AiProvider {
  readonly name: string;
  readonly supportedPurposes: AiPurpose[];

  ocr?(input: AiJobInput): Promise<OcrResult>;
  generateTags?(input: AiJobInput): Promise<TaggingResult>;
  generateTitle?(input: AiJobInput): Promise<TitleResult>;
  transcribe?(input: AiJobInput): Promise<TranscriptionResult>;
  detectFaces?(input: AiJobInput): Promise<FaceDetectionResult>;
  generateEmbedding?(input: AiJobInput): Promise<EmbeddingResult>;
}
