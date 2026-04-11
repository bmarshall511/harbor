import { db } from '../client';
import type { EntityType, RelationType } from '../../generated/prisma/client';

export class RelationRepository {
  async findByEntity(entityType: EntityType, entityId: string) {
    return db.entityRelation.findMany({
      where: {
        OR: [
          { sourceType: entityType, sourceId: entityId },
          { targetType: entityType, targetId: entityId, isBidirectional: true },
        ],
      },
      include: { createdBy: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByType(relationType: RelationType) {
    return db.entityRelation.findMany({
      where: { relationType },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    sourceType: EntityType;
    sourceId: string;
    targetType: EntityType;
    targetId: string;
    relationType: RelationType;
    isBidirectional?: boolean;
    confidence?: number;
    source?: string;
    notes?: string;
    createdById?: string;
  }) {
    return db.entityRelation.create({
      data: {
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relationType: data.relationType,
        isBidirectional: data.isBidirectional ?? true,
        confidence: data.confidence,
        source: data.source ?? 'manual',
        notes: data.notes,
        createdById: data.createdById,
      },
    });
  }

  async delete(id: string) {
    return db.entityRelation.delete({ where: { id } });
  }

  async findDuplicateCandidates(entityType: EntityType, entityId: string) {
    return db.entityRelation.findMany({
      where: {
        relationType: 'DUPLICATE_CANDIDATE',
        OR: [
          { sourceType: entityType, sourceId: entityId },
          { targetType: entityType, targetId: entityId },
        ],
      },
    });
  }
}
