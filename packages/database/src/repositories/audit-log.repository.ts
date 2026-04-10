import { db } from '../client';
import type { EntityType, Prisma } from '@prisma/client';

export class AuditLogRepository {
  async log(data: {
    userId?: string;
    action: string;
    entityType: EntityType;
    entityId: string;
    before?: unknown;
    after?: unknown;
    ipAddress?: string;
  }) {
    return db.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        before: data.before as Prisma.InputJsonValue,
        after: data.after as Prisma.InputJsonValue,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findByEntity(entityType: EntityType, entityId: string, limit: number = 50) {
    return db.auditLog.findMany({
      where: { entityType, entityId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findByUser(userId: string, limit: number = 50) {
    return db.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findRecent(limit: number = 100) {
    return db.auditLog.findMany({
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
