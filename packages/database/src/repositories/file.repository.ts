import { db } from '../client';
import type { FileStatus, Prisma } from '@prisma/client';

/**
 * Statuses that should be EXCLUDED from any "user-visible" file
 * listing. `DELETED` is the hard tombstone (file is gone from
 * provider); `PENDING_DELETE` means the user has marked the file
 * for delete but an admin hasn't approved removal yet — the bytes
 * are still on disk but the UI must hide it everywhere.
 */
const HIDDEN_STATUSES: FileStatus[] = ['DELETED', 'PENDING_DELETE'];

export class FileRepository {
  async findById(id: string) {
    return db.file.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        previews: true,
        folder: true,
      },
    });
  }

  async findByPath(archiveRootId: string, path: string) {
    return db.file.findUnique({
      where: { archiveRootId_path: { archiveRootId, path } },
    });
  }

  async findByFolderId(folderId: string, options?: { limit?: number; offset?: number }) {
    return db.file.findMany({
      where: { folderId, status: { notIn: HIDDEN_STATUSES } },
      include: {
        tags: { include: { tag: true } },
        previews: { where: { size: 'THUMBNAIL' } },
      },
      orderBy: { name: 'asc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async findByArchiveRoot(archiveRootId: string, options?: { limit?: number; offset?: number }) {
    return db.file.findMany({
      where: { archiveRootId, folderId: null, status: { notIn: HIDDEN_STATUSES } },
      include: {
        tags: { include: { tag: true } },
        previews: { where: { size: 'THUMBNAIL' } },
      },
      orderBy: { name: 'asc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async countByFolderId(folderId: string) {
    return db.file.count({
      where: { folderId, status: { notIn: HIDDEN_STATUSES } },
    });
  }

  async create(data: Prisma.FileCreateInput) {
    return db.file.create({ data });
  }

  async upsertByPath(archiveRootId: string, path: string, data: Prisma.FileCreateInput) {
    return db.file.upsert({
      where: { archiveRootId_path: { archiveRootId, path } },
      create: data,
      update: {
        name: data.name,
        mimeType: data.mimeType,
        size: data.size,
        hash: data.hash,
        folder: data.folder,
        fileModifiedAt: data.fileModifiedAt,
        status: 'INDEXED' as FileStatus,
        indexedAt: new Date(),
      },
    });
  }

  /**
   * Delete all files for an archive root that were not touched since
   * the given timestamp. We never auto-delete files in `PENDING_DELETE`
   * state — those represent explicit user intent and are owned by
   * the admin delete-queue flow, not the indexer.
   */
  async deleteStale(archiveRootId: string, since: Date) {
    return db.file.deleteMany({
      where: {
        archiveRootId,
        status: { notIn: HIDDEN_STATUSES },
        OR: [
          { indexedAt: null },
          { indexedAt: { lt: since } },
        ],
      },
    });
  }

  async update(id: string, data: Prisma.FileUpdateInput) {
    return db.file.update({ where: { id }, data });
  }

  async updateStatus(id: string, status: FileStatus) {
    return db.file.update({
      where: { id },
      data: { status, indexedAt: status === 'INDEXED' ? new Date() : undefined },
    });
  }

  /**
   * Soft-delete: mark the file as PENDING_DELETE so it disappears
   * from listings. The bytes stay on disk; an admin must approve
   * the delete-queue entry before the file is actually removed.
   */
  async markForDelete(id: string) {
    return db.file.update({
      where: { id },
      data: { status: 'PENDING_DELETE' },
    });
  }

  /**
   * Restore a file out of PENDING_DELETE back to indexed state
   * (used when an admin rejects a delete request).
   */
  async unmarkForDelete(id: string) {
    return db.file.update({
      where: { id },
      data: { status: 'INDEXED' },
    });
  }

  /**
   * Hard delete: drop the row entirely. Use ONLY after the bytes
   * have been removed from the provider (admin approval flow).
   */
  async hardDelete(id: string) {
    return db.file.delete({ where: { id } });
  }

  async findDuplicateCandidates(hash: string, excludeId?: string) {
    return db.file.findMany({
      where: {
        hash,
        status: 'INDEXED',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async findPendingIndexing(limit: number = 100) {
    return db.file.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
