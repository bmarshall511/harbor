import { db } from '../client';
import type { Prisma } from '@prisma/client';

export class FolderRepository {
  async findById(id: string) {
    return db.folder.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { children: true, files: true } },
      },
    });
  }

  async findByPath(archiveRootId: string, path: string) {
    return db.folder.findUnique({
      where: { archiveRootId_path: { archiveRootId, path } },
    });
  }

  async findChildren(parentId: string) {
    return db.folder.findMany({
      where: { parentId },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { children: true, files: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findRootFolders(archiveRootId: string) {
    // Defensive: a long-standing indexer bug could create a folder
    // record whose `path` matches the archive root's own `rootPath`
    // (e.g. when ensureFolderHierarchy walked an absolute Dropbox path
    // and treated the root container itself as a folder). Such a
    // record shows up as a root-level folder in the sidebar named
    // identically to the archive root — a duplicate.
    //
    // We exclude any folder whose path matches the archive root path
    // in any of its plausible normalized forms.
    const root = await db.archiveRoot.findUnique({
      where: { id: archiveRootId },
      select: { rootPath: true, name: true },
    });
    const skipPaths = new Set<string>();
    if (root?.rootPath) {
      const normalized = root.rootPath.replace(/^\/+|\/+$/g, '');
      if (normalized) {
        skipPaths.add(normalized);
        skipPaths.add(`/${normalized}`);
        // Just the basename — what `ensureFolderHierarchy` would create
        // when given an absolute path like `/My Archive/Photos`.
        const basename = normalized.split('/').pop();
        if (basename) skipPaths.add(basename);
      }
    }

    return db.folder.findMany({
      where: {
        archiveRootId,
        parentId: null,
        ...(skipPaths.size > 0 ? { path: { notIn: [...skipPaths] } } : {}),
      },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { children: true, files: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findTree(archiveRootId: string, maxDepth: number = 3) {
    return db.folder.findMany({
      where: { archiveRootId, depth: { lte: maxDepth } },
      include: {
        _count: { select: { children: true, files: true } },
      },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    });
  }

  async create(data: Prisma.FolderCreateInput) {
    return db.folder.create({ data });
  }

  async upsertByPath(archiveRootId: string, path: string, data: Prisma.FolderCreateInput) {
    const now = new Date();
    return db.folder.upsert({
      where: { archiveRootId_path: { archiveRootId, path } },
      create: { ...data, indexedAt: now },
      update: {
        name: data.name,
        depth: data.depth as number | undefined,
        parent: data.parent,
        indexedAt: now,
      },
    });
  }

  /** Delete all folders for an archive root that were not touched since the given timestamp. */
  async deleteStale(archiveRootId: string, since: Date) {
    return db.folder.deleteMany({
      where: {
        archiveRootId,
        OR: [
          { indexedAt: null },
          { indexedAt: { lt: since } },
        ],
      },
    });
  }

  async update(id: string, data: Prisma.FolderUpdateInput) {
    return db.folder.update({ where: { id }, data });
  }

  async delete(id: string) {
    return db.folder.delete({ where: { id } });
  }
}
