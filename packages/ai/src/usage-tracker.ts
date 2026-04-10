import { db } from '@harbor/database';
import type { AiJobStatus } from '@harbor/types';

// Cost per 1M tokens (approximate, updated as pricing changes)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'whisper-1': { input: 0.006, output: 0 }, // per second
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

export class AiUsageTracker {
  async createJob(data: {
    userId?: string;
    provider: string;
    model: string;
    purpose: string;
    entityType?: 'FILE' | 'FOLDER';
    entityId?: string;
  }): Promise<string> {
    const job = await db.aiJob.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        model: data.model,
        purpose: data.purpose,
        entityType: data.entityType as any,
        entityId: data.entityId,
        status: 'QUEUED',
      },
    });
    return job.id;
  }

  async markRunning(jobId: string): Promise<void> {
    await db.aiJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async markCompleted(
    jobId: string,
    result: {
      inputTokens?: number;
      outputTokens?: number;
      result?: unknown;
    },
  ): Promise<void> {
    const job = await db.aiJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    const elapsedMs = job.startedAt ? Date.now() - job.startedAt.getTime() : null;
    const estimatedCost = this.estimateCost(
      job.model,
      result.inputTokens ?? 0,
      result.outputTokens ?? 0,
    );

    await db.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        elapsedMs,
        estimatedCost,
        result: result.result as any,
      },
    });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const job = await db.aiJob.findUnique({ where: { id: jobId } });
    const elapsedMs = job?.startedAt ? Date.now() - job.startedAt.getTime() : null;

    await db.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error,
        elapsedMs,
      },
    });
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const rates = COST_TABLE[model];
    if (!rates) return 0;
    return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  async getUsageSummary(options?: { userId?: string; startDate?: Date; endDate?: Date }) {
    const where: any = { status: 'COMPLETED' };
    if (options?.userId) where.userId = options.userId;
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) where.createdAt.gte = options.startDate;
      if (options?.endDate) where.createdAt.lte = options.endDate;
    }

    const jobs = await db.aiJob.findMany({ where });
    const totalCost = jobs.reduce((sum, j) => sum + (j.estimatedCost ?? 0), 0);
    const totalTokens = jobs.reduce(
      (sum, j) => sum + (j.inputTokens ?? 0) + (j.outputTokens ?? 0),
      0,
    );
    const byPurpose = new Map<string, number>();
    const byProvider = new Map<string, number>();

    for (const job of jobs) {
      byPurpose.set(job.purpose, (byPurpose.get(job.purpose) ?? 0) + (job.estimatedCost ?? 0));
      byProvider.set(job.provider, (byProvider.get(job.provider) ?? 0) + (job.estimatedCost ?? 0));
    }

    return {
      totalJobs: jobs.length,
      totalCost,
      totalTokens,
      byPurpose: Object.fromEntries(byPurpose),
      byProvider: Object.fromEntries(byProvider),
    };
  }
}
