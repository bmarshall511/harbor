import { db } from './client';

// ── Permission definitions per role ──────────────────────────────────
// Owner is immutable (always has all permissions via fast-path),
// but we still seed explicit records so the admin UI can display them.

const SETTINGS_PERMISSIONS = [
  'settings.appearance',
  'settings.general',
  'settings.users',
  'settings.people',
  'settings.search_analytics',
  'settings.metadata_fields',
  'settings.archive_roots',
  'settings.dropbox',
  'settings.ai',
  'settings.delete_queue',
  'settings.job_log',
  'settings.database',
  'settings.about',
] as const;

const ITEM_FIELDS = [
  'items.title',
  'items.description',
  'items.tags',
  'items.adult_content',
  'items.people',
  'items.file_metadata',
] as const;

type Perm = { resource: string; action: string };

function settingsAccess(resources: readonly string[]): Perm[] {
  return resources.map((r) => ({ resource: r, action: 'access' }));
}

function itemPerms(fields: readonly string[], actions: string[]): Perm[] {
  return fields.flatMap((f) => actions.map((a) => ({ resource: f, action: a })));
}

// ── Role permission sets ─────────────────────────────────────────────

const OWNER_PERMISSIONS: Perm[] = [
  // Files
  { resource: 'files', action: 'read' },
  { resource: 'files', action: 'write' },
  { resource: 'files', action: 'delete' },
  // Metadata
  { resource: 'metadata', action: 'read' },
  { resource: 'metadata', action: 'write' },
  // Tags
  { resource: 'tags', action: 'read' },
  { resource: 'tags', action: 'write' },
  { resource: 'tags', action: 'delete' },
  // Relations
  { resource: 'relations', action: 'read' },
  { resource: 'relations', action: 'write' },
  { resource: 'relations', action: 'delete' },
  // Users
  { resource: 'users', action: 'manage' },
  // Settings (all)
  ...settingsAccess(SETTINGS_PERMISSIONS),
  // Items (all view + edit)
  ...itemPerms(ITEM_FIELDS, ['view', 'edit']),
  // Review
  { resource: 'review', action: 'access' },
];

const ADMIN_PERMISSIONS: Perm[] = [
  // Files
  { resource: 'files', action: 'read' },
  { resource: 'files', action: 'write' },
  { resource: 'files', action: 'delete' },
  // Metadata
  { resource: 'metadata', action: 'read' },
  { resource: 'metadata', action: 'write' },
  // Tags
  { resource: 'tags', action: 'read' },
  { resource: 'tags', action: 'write' },
  { resource: 'tags', action: 'delete' },
  // Relations
  { resource: 'relations', action: 'read' },
  { resource: 'relations', action: 'write' },
  { resource: 'relations', action: 'delete' },
  // Settings (all)
  ...settingsAccess(SETTINGS_PERMISSIONS),
  // Items (all view + edit)
  ...itemPerms(ITEM_FIELDS, ['view', 'edit']),
  // Review
  { resource: 'review', action: 'access' },
];

const EDITOR_PERMISSIONS: Perm[] = [
  // Files
  { resource: 'files', action: 'read' },
  { resource: 'files', action: 'write' },
  // Metadata
  { resource: 'metadata', action: 'read' },
  { resource: 'metadata', action: 'write' },
  // Tags
  { resource: 'tags', action: 'read' },
  { resource: 'tags', action: 'write' },
  // Relations
  { resource: 'relations', action: 'read' },
  { resource: 'relations', action: 'write' },
  // Settings (limited)
  { resource: 'settings.appearance', action: 'access' },
  { resource: 'settings.about', action: 'access' },
  // Items (all view + edit)
  ...itemPerms(ITEM_FIELDS, ['view', 'edit']),
  // Review
  { resource: 'review', action: 'access' },
];

const VIEWER_PERMISSIONS: Perm[] = [
  // Files
  { resource: 'files', action: 'read' },
  // Metadata
  { resource: 'metadata', action: 'read' },
  // Tags
  { resource: 'tags', action: 'read' },
  // Relations
  { resource: 'relations', action: 'read' },
  // Settings (limited)
  { resource: 'settings.appearance', action: 'access' },
  { resource: 'settings.about', action: 'access' },
  // Items (view only)
  ...itemPerms(ITEM_FIELDS, ['view']),
];

const GUEST_PERMISSIONS: Perm[] = [
  // Files
  { resource: 'files', action: 'read' },
  // Tags
  { resource: 'tags', action: 'read' },
  // Settings (about only)
  { resource: 'settings.about', action: 'access' },
  // Items (limited view)
  { resource: 'items.title', action: 'view' },
  { resource: 'items.description', action: 'view' },
  { resource: 'items.tags', action: 'view' },
  { resource: 'items.people', action: 'view' },
];

// ── Seed function ────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding Harbor database...');

  // Helper to upsert a role and sync its permissions
  async function upsertRole(
    name: string,
    systemRole: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST',
    description: string,
    permissions: Perm[],
  ) {
    const role = await db.role.upsert({
      where: { name },
      create: { name, systemRole, description },
      update: { description },
    });

    // Delete old permissions and replace with current set
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await db.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId: role.id,
          resource: p.resource,
          action: p.action,
        })),
        skipDuplicates: true,
      });
    }

    return role;
  }

  const ownerRole = await upsertRole('Owner', 'OWNER', 'Full system access', OWNER_PERMISSIONS);
  await upsertRole('Admin', 'ADMIN', 'Administrative access', ADMIN_PERMISSIONS);
  await upsertRole('Editor', 'EDITOR', 'Can edit metadata and manage files within permitted archive roots', EDITOR_PERMISSIONS);
  await upsertRole('Viewer', 'VIEWER', 'Read-only access to permitted archive roots', VIEWER_PERMISSIONS);
  await upsertRole('Guest', 'GUEST', 'Very limited read-only access', GUEST_PERMISSIONS);

  // Seed custom field permissions for existing metadata field templates
  const templates = await db.metadataFieldTemplate.findMany();
  if (templates.length > 0) {
    const roles = await db.role.findMany();
    for (const tmpl of templates) {
      const resource = `items.custom.${tmpl.key}`;
      for (const role of roles) {
        const permsToAdd: Perm[] = [];
        // Owner, Admin, Editor get view+edit; Viewer gets view; Guest gets nothing
        if (['OWNER', 'ADMIN', 'EDITOR'].includes(role.systemRole)) {
          permsToAdd.push({ resource, action: 'view' }, { resource, action: 'edit' });
        } else if (role.systemRole === 'VIEWER') {
          permsToAdd.push({ resource, action: 'view' });
        }
        if (permsToAdd.length > 0) {
          await db.rolePermission.createMany({
            data: permsToAdd.map((p) => ({ roleId: role.id, resource: p.resource, action: p.action })),
            skipDuplicates: true,
          });
        }
      }
    }
  }

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
  .finally(() => process.exit(0));
