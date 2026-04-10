import { db } from '../client';
import type { Prisma } from '@prisma/client';

export class ArchiveRootRepository {
  async findAll() {
    return db.archiveRoot.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    return db.archiveRoot.findUnique({ where: { id } });
  }

  async findAccessibleByRoleIds(roleIds: string[]) {
    return db.archiveRoot.findMany({
      where: {
        isActive: true,
        OR: [
          { isPrivate: false },
          { accesses: { some: { roleId: { in: roleIds } } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: Prisma.ArchiveRootCreateInput) {
    return db.archiveRoot.create({ data });
  }

  async update(id: string, data: Prisma.ArchiveRootUpdateInput) {
    return db.archiveRoot.update({ where: { id }, data });
  }

  async delete(id: string) {
    return db.archiveRoot.delete({ where: { id } });
  }

  async grantAccess(archiveRootId: string, roleId: string) {
    return db.archiveRootAccess.upsert({
      where: { archiveRootId_roleId: { archiveRootId, roleId } },
      create: { archiveRootId, roleId },
      update: {},
    });
  }

  async revokeAccess(archiveRootId: string, roleId: string) {
    return db.archiveRootAccess.deleteMany({
      where: { archiveRootId, roleId },
    });
  }
}
