import { NextResponse } from 'next/server';
import { AuditLogRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const repo = new AuditLogRepository();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get('entityType') as 'FILE' | 'FOLDER' | null;
  const entityId = searchParams.get('entityId');
  const limit = Number(searchParams.get('limit') ?? 50);

  let logs;
  if (entityType && entityId) {
    logs = await repo.findByEntity(entityType, entityId, limit);
  } else {
    logs = await repo.findRecent(limit);
  }

  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: (l as any).user?.displayName ?? null,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      createdAt: l.createdAt.toISOString(),
    })),
  );
}
