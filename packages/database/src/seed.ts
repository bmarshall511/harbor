import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function seed() {
  console.log('Seeding Harbor database...');

  // Create default roles
  const ownerRole = await db.role.upsert({
    where: { name: 'Owner' },
    create: {
      name: 'Owner',
      systemRole: 'OWNER',
      description: 'Full system access',
      permissions: {
        createMany: {
          data: [
            { resource: 'files', action: 'read' },
            { resource: 'files', action: 'write' },
            { resource: 'files', action: 'delete' },
            { resource: 'files', action: 'manage' },
            { resource: 'metadata', action: 'read' },
            { resource: 'metadata', action: 'write' },
            { resource: 'tags', action: 'read' },
            { resource: 'tags', action: 'write' },
            { resource: 'tags', action: 'delete' },
            { resource: 'relations', action: 'read' },
            { resource: 'relations', action: 'write' },
            { resource: 'relations', action: 'delete' },
            { resource: 'admin', action: 'manage' },
            { resource: 'users', action: 'manage' },
            { resource: 'archive_roots', action: 'manage' },
          ],
        },
      },
    },
    update: {},
  });

  await db.role.upsert({
    where: { name: 'Admin' },
    create: {
      name: 'Admin',
      systemRole: 'ADMIN',
      description: 'Administrative access without user management',
      permissions: {
        createMany: {
          data: [
            { resource: 'files', action: 'read' },
            { resource: 'files', action: 'write' },
            { resource: 'files', action: 'delete' },
            { resource: 'metadata', action: 'read' },
            { resource: 'metadata', action: 'write' },
            { resource: 'tags', action: 'read' },
            { resource: 'tags', action: 'write' },
            { resource: 'tags', action: 'delete' },
            { resource: 'relations', action: 'read' },
            { resource: 'relations', action: 'write' },
            { resource: 'relations', action: 'delete' },
            { resource: 'admin', action: 'manage' },
            { resource: 'archive_roots', action: 'manage' },
          ],
        },
      },
    },
    update: {},
  });

  await db.role.upsert({
    where: { name: 'Editor' },
    create: {
      name: 'Editor',
      systemRole: 'EDITOR',
      description: 'Can edit metadata and manage files within permitted archive roots',
      permissions: {
        createMany: {
          data: [
            { resource: 'files', action: 'read' },
            { resource: 'files', action: 'write' },
            { resource: 'metadata', action: 'read' },
            { resource: 'metadata', action: 'write' },
            { resource: 'tags', action: 'read' },
            { resource: 'tags', action: 'write' },
            { resource: 'relations', action: 'read' },
            { resource: 'relations', action: 'write' },
          ],
        },
      },
    },
    update: {},
  });

  await db.role.upsert({
    where: { name: 'Viewer' },
    create: {
      name: 'Viewer',
      systemRole: 'VIEWER',
      description: 'Read-only access to permitted archive roots',
      permissions: {
        createMany: {
          data: [
            { resource: 'files', action: 'read' },
            { resource: 'metadata', action: 'read' },
            { resource: 'tags', action: 'read' },
            { resource: 'relations', action: 'read' },
          ],
        },
      },
    },
    update: {},
  });

  await db.role.upsert({
    where: { name: 'Guest' },
    create: {
      name: 'Guest',
      systemRole: 'GUEST',
      description: 'Very limited read-only access',
      permissions: {
        createMany: {
          data: [
            { resource: 'files', action: 'read' },
            { resource: 'tags', action: 'read' },
          ],
        },
      },
    },
    update: {},
  });

  // Create default local user (for single-user desktop mode)
  await db.user.upsert({
    where: { username: 'local' },
    create: {
      username: 'local',
      displayName: 'Local User',
      isLocalUser: true,
      isActive: true,
      roleAssignments: {
        create: { roleId: ownerRole.id },
      },
    },
    update: {},
  });

  // Seed default system settings (only if not already set)
  const defaultSettings: Record<string, string> = {
    'auth.mode': 'local',
    'preview.cacheDir': './data/preview-cache',
    'ai.enabled': 'false',
    'ai.faceRecognition': 'false',
    'ai.defaultProvider': 'openai',
    'log.level': 'info',
    'dropbox.redirectUri': 'http://localhost:3000/api/auth/dropbox/callback',
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: {}, // Don't overwrite existing settings
    });
  }

  console.log('Seed complete.');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
