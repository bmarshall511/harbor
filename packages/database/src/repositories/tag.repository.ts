import { db } from '../client';

/**
 * Tag reads always derive `usageCount` from a real `_count` join
 * over the `FileTag` and `FolderTag` join tables. The legacy
 * `usageCount` column on `Tag` exists but is no longer maintained
 * (the indexer / file watcher / PATCH route all upsert join rows
 * directly via `syncTagsForFile` which sidesteps the increment),
 * so a derived count is the only correct number to show users.
 */
function withDerivedCount<T extends { _count: { fileTags: number; folderTags: number } }>(
  tag: T,
): Omit<T, '_count'> & { usageCount: number } {
  const { _count, ...rest } = tag;
  return { ...rest, usageCount: (_count?.fileTags ?? 0) + (_count?.folderTags ?? 0) };
}

const TAG_COUNT_INCLUDE = {
  _count: { select: { fileTags: true, folderTags: true } },
} as const;

export class TagRepository {
  async findAll(options?: { category?: string; search?: string; limit?: number }) {
    const rows = await db.tag.findMany({
      where: {
        ...(options?.category ? { category: options.category } : {}),
        ...(options?.search ? { name: { contains: options.search, mode: 'insensitive' as const } } : {}),
      },
      include: TAG_COUNT_INCLUDE,
      take: options?.limit ?? 200,
    });
    // Sort in memory by derived count desc; the cached `usageCount`
    // column is unreliable so we can't ORDER BY it.
    return rows
      .map(withDerivedCount)
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  async findById(id: string) {
    return db.tag.findUnique({ where: { id } });
  }

  async findByName(name: string) {
    return db.tag.findUnique({ where: { name } });
  }

  async findOrCreate(name: string, category?: string) {
    const existing = await db.tag.findUnique({ where: { name } });
    if (existing) return existing;
    return db.tag.create({ data: { name, category } });
  }

  async search(query: string, limit: number = 20) {
    const rows = await db.tag.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      include: TAG_COUNT_INCLUDE,
      take: limit,
    });
    return rows
      .map(withDerivedCount)
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  async addToFile(fileId: string, tagId: string, source: string = 'manual', confidence?: number) {
    const result = await db.fileTag.upsert({
      where: { fileId_tagId: { fileId, tagId } },
      create: { fileId, tagId, source, confidence },
      update: { source, confidence },
    });
    await db.tag.update({
      where: { id: tagId },
      data: { usageCount: { increment: 1 } },
    });
    return result;
  }

  async removeFromFile(fileId: string, tagId: string) {
    await db.fileTag.delete({
      where: { fileId_tagId: { fileId, tagId } },
    });
    await db.tag.update({
      where: { id: tagId },
      data: { usageCount: { decrement: 1 } },
    });
  }

  async addToFolder(folderId: string, tagId: string, source: string = 'manual') {
    const result = await db.folderTag.upsert({
      where: { folderId_tagId: { folderId, tagId } },
      create: { folderId, tagId, source },
      update: { source },
    });
    await db.tag.update({
      where: { id: tagId },
      data: { usageCount: { increment: 1 } },
    });
    return result;
  }

  async removeFromFolder(folderId: string, tagId: string) {
    await db.folderTag.delete({
      where: { folderId_tagId: { folderId, tagId } },
    });
    await db.tag.update({
      where: { id: tagId },
      data: { usageCount: { decrement: 1 } },
    });
  }

  async getCategories() {
    const result = await db.tag.groupBy({
      by: ['category'],
      where: { category: { not: null } },
      _count: true,
    });
    return result.map((r) => ({ category: r.category!, count: r._count }));
  }
}
