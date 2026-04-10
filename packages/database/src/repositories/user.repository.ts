import { db } from '../client';
import type { Prisma } from '@prisma/client';

export class UserRepository {
  async findById(id: string) {
    return db.user.findUnique({
      where: { id },
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  async findByUsername(username: string) {
    return db.user.findUnique({
      where: { username },
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  async findByEmail(email: string) {
    return db.user.findUnique({
      where: { email },
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  async findAll() {
    return db.user.findMany({
      include: {
        roleAssignments: { include: { role: true } },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async create(data: Prisma.UserCreateInput) {
    return db.user.create({
      data,
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput) {
    return db.user.update({ where: { id }, data });
  }

  async assignRole(userId: string, roleId: string) {
    return db.userRoleAssignment.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
  }

  async removeRole(userId: string, roleId: string) {
    return db.userRoleAssignment.deleteMany({
      where: { userId, roleId },
    });
  }

  async createSession(userId: string, token: string, expiresAt: Date, meta?: { userAgent?: string; ipAddress?: string }) {
    return db.session.create({
      data: { userId, token, expiresAt, ...meta },
    });
  }

  async findSessionByToken(token: string) {
    return db.session.findUnique({
      where: { token },
      include: {
        user: {
          include: {
            roleAssignments: { include: { role: { include: { permissions: true } } } },
          },
        },
      },
    });
  }

  async deleteSession(token: string) {
    return db.session.delete({ where: { token } });
  }

  async deleteExpiredSessions() {
    return db.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  async getLocalUser() {
    return db.user.findFirst({
      where: { isLocalUser: true },
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  async ensureLocalUser() {
    const existing = await this.getLocalUser();
    if (existing) return existing;

    const ownerRole = await db.role.findFirst({ where: { systemRole: 'OWNER' } });
    if (!ownerRole) {
      throw new Error('Owner role not found. Run database seed first.');
    }

    return db.user.create({
      data: {
        username: 'local',
        displayName: 'Local User',
        isLocalUser: true,
        isActive: true,
        roleAssignments: {
          create: { roleId: ownerRole.id },
        },
      },
      include: {
        roleAssignments: { include: { role: { include: { permissions: true } } } },
      },
    });
  }
}
