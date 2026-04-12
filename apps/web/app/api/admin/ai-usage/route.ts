import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/admin/ai-usage — AI usage statistics for the admin dashboard.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.ai', 'access');
  if (denied) return denied;

  try {
    const jobs = await db.aiJob.findMany({
      where: { status: 'COMPLETED' },
      select: {
        id: true,
        purpose: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCost: true,
        elapsedMs: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const byPurpose: Record<string, { count: number; cost: number }> = {};
    const byProvider: Record<string, { count: number; cost: number }> = {};

    for (const job of jobs) {
      const cost = job.estimatedCost ?? 0;
      totalCost += cost;
      totalInputTokens += job.inputTokens ?? 0;
      totalOutputTokens += job.outputTokens ?? 0;

      if (!byPurpose[job.purpose]) byPurpose[job.purpose] = { count: 0, cost: 0 };
      byPurpose[job.purpose].count++;
      byPurpose[job.purpose].cost += cost;

      if (!byProvider[job.provider]) byProvider[job.provider] = { count: 0, cost: 0 };
      byProvider[job.provider].count++;
      byProvider[job.provider].cost += cost;
    }

    return NextResponse.json({
      totalJobs: jobs.length,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      byPurpose,
      byProvider,
      recent: jobs.slice(0, 20).map((j) => ({
        id: j.id,
        purpose: j.purpose,
        provider: j.provider,
        model: j.model,
        cost: j.estimatedCost,
        elapsedMs: j.elapsedMs,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[AI Usage] Failed:', err);
    return NextResponse.json({
      totalJobs: 0, totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
      byPurpose: {}, byProvider: {}, recent: [],
    });
  }
}
