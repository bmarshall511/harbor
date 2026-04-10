import { db } from '@harbor/database';
import type { JobDefinition } from './types';

export class JobManager {
  async enqueue(job: JobDefinition): Promise<string> {
    const record = await db.backgroundJob.create({
      data: {
        type: job.type,
        entityType: job.entityType as any,
        entityId: job.entityId,
        metadata: job.metadata as any,
        status: 'QUEUED',
      },
    });
    return record.id;
  }

  async markRunning(jobId: string): Promise<void> {
    await db.backgroundJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async markCompleted(jobId: string): Promise<void> {
    await db.backgroundJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date(), progress: 1 },
    });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await db.backgroundJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error, completedAt: new Date() },
    });
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    await db.backgroundJob.update({
      where: { id: jobId },
      data: { progress },
    });
  }

  async findPending(type?: string, limit: number = 10) {
    return db.backgroundJob.findMany({
      where: {
        status: 'QUEUED',
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findActive() {
    return db.backgroundJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRecent(limit: number = 50) {
    return db.backgroundJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
