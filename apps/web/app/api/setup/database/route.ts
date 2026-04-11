import { NextResponse } from 'next/server';

/**
 * GET /api/setup/database — Check if the database is initialized.
 * POST /api/setup/database — Seed default data and apply search indexes.
 *
 * The database SCHEMA (tables, columns, indexes) is created during
 * the build step via `prisma db push`. This endpoint only handles:
 *   1. Seeding default roles, local user, and system settings
 *   2. Applying the search foundation SQL (triggers + GIN indexes)
 *
 * Unauthenticated — only works when the database has no system
 * settings yet (first-time setup). Returns 403 once initialized.
 */

async function isDatabaseInitialized(): Promise<boolean> {
  try {
    const { db } = await import('@harbor/database');
    const count = await db.systemSetting.count();
    return count > 0;
  } catch {
    return false;
  }
}

async function doTablesExist(): Promise<{ exists: boolean; error?: string }> {
  try {
    const { db } = await import('@harbor/database');
    await db.$queryRaw`SELECT 1 FROM system_settings LIMIT 0`;
    return { exists: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Setup] doTablesExist check failed:', message);
    // Distinguish "table doesn't exist" from "can't connect"
    if (message.includes('does not exist') || message.includes('relation') || message.includes('undefined table')) {
      return { exists: false, error: 'Tables not created yet' };
    }
    // Connection or auth error — tables might exist but we can't reach DB
    return { exists: false, error: message };
  }
}

export async function GET() {
  const tableCheck = await doTablesExist();
  const initialized = tableCheck.exists ? await isDatabaseInitialized() : false;
  return NextResponse.json({
    initialized,
    tablesExist: tableCheck.exists,
    ...(tableCheck.error ? { dbError: tableCheck.error } : {}),
  });
}

export async function POST() {
  // Safety: block if already initialized
  const initialized = await isDatabaseInitialized();
  if (initialized) {
    return NextResponse.json(
      { message: 'Database is already initialized.' },
      { status: 403 },
    );
  }

  // Check if tables exist (created via prisma db push)
  const tableCheck = await doTablesExist();
  if (!tableCheck.exists) {
    return NextResponse.json({
      message: tableCheck.error ?? 'Database tables not found. Run "pnpm db:push" to create them.',
      steps: [{ step: 'Schema check', status: 'error', message: tableCheck.error ?? 'Tables not found' }],
    }, { status: 500 });
  }

  const steps: Array<{ step: string; status: 'ok' | 'error'; message?: string }> = [];
  const { db } = await import('@harbor/database');

  // Step 1: Seed roles
  try {
    const roleData = [
      {
        name: 'Owner', systemRole: 'OWNER' as const, description: 'Full system access',
        perms: [
          { resource: 'files', action: 'read' }, { resource: 'files', action: 'write' },
          { resource: 'files', action: 'delete' }, { resource: 'files', action: 'manage' },
          { resource: 'metadata', action: 'read' }, { resource: 'metadata', action: 'write' },
          { resource: 'tags', action: 'read' }, { resource: 'tags', action: 'write' },
          { resource: 'tags', action: 'delete' },
          { resource: 'relations', action: 'read' }, { resource: 'relations', action: 'write' },
          { resource: 'relations', action: 'delete' },
          { resource: 'admin', action: 'manage' }, { resource: 'users', action: 'manage' },
          { resource: 'archive_roots', action: 'manage' },
        ],
      },
      {
        name: 'Admin', systemRole: 'ADMIN' as const, description: 'Administrative access',
        perms: [
          { resource: 'files', action: 'read' }, { resource: 'files', action: 'write' },
          { resource: 'files', action: 'delete' },
          { resource: 'metadata', action: 'read' }, { resource: 'metadata', action: 'write' },
          { resource: 'tags', action: 'read' }, { resource: 'tags', action: 'write' },
          { resource: 'tags', action: 'delete' },
          { resource: 'relations', action: 'read' }, { resource: 'relations', action: 'write' },
          { resource: 'relations', action: 'delete' },
          { resource: 'admin', action: 'manage' }, { resource: 'archive_roots', action: 'manage' },
        ],
      },
      {
        name: 'Editor', systemRole: 'EDITOR' as const, description: 'Edit metadata and manage files',
        perms: [
          { resource: 'files', action: 'read' }, { resource: 'files', action: 'write' },
          { resource: 'metadata', action: 'read' }, { resource: 'metadata', action: 'write' },
          { resource: 'tags', action: 'read' }, { resource: 'tags', action: 'write' },
          { resource: 'relations', action: 'read' }, { resource: 'relations', action: 'write' },
        ],
      },
      {
        name: 'Viewer', systemRole: 'VIEWER' as const, description: 'Read-only access',
        perms: [
          { resource: 'files', action: 'read' }, { resource: 'metadata', action: 'read' },
          { resource: 'tags', action: 'read' }, { resource: 'relations', action: 'read' },
        ],
      },
      {
        name: 'Guest', systemRole: 'GUEST' as const, description: 'Very limited access',
        perms: [{ resource: 'files', action: 'read' }, { resource: 'tags', action: 'read' }],
      },
    ];

    for (const role of roleData) {
      await db.role.upsert({
        where: { name: role.name },
        create: {
          name: role.name,
          systemRole: role.systemRole,
          description: role.description,
          permissions: { createMany: { data: role.perms } },
        },
        update: {},
      });
    }
    steps.push({ step: 'Roles', status: 'ok' });
  } catch (err: unknown) {
    steps.push({ step: 'Roles', status: 'error', message: err instanceof Error ? err.message : 'Failed' });
    return NextResponse.json({ message: 'Failed to create roles', steps }, { status: 500 });
  }

  // Step 2: Create local user (only in local mode — cloud mode
  // requires the user to create an admin account via the setup form)
  const isCloud = process.env.HARBOR_DEPLOYMENT_MODE === 'cloud';
  if (!isCloud) {
    try {
      const ownerRole = await db.role.findFirst({ where: { systemRole: 'OWNER' } });
      const localUser = await db.user.upsert({
        where: { username: 'local' },
        create: { username: 'local', displayName: 'Local User', isLocalUser: true, isActive: true },
        update: {},
      });
      if (ownerRole) {
        await db.userRoleAssignment.upsert({
          where: { userId_roleId: { userId: localUser.id, roleId: ownerRole.id } },
          create: { userId: localUser.id, roleId: ownerRole.id },
          update: {},
        });
      }
      steps.push({ step: 'Local user', status: 'ok' });
    } catch (err: unknown) {
      steps.push({ step: 'Local user', status: 'error', message: err instanceof Error ? err.message : 'Failed' });
    }
  } else {
    steps.push({ step: 'Local user', status: 'ok', message: 'Skipped — cloud mode requires admin account creation' });
  }

  // Step 3: Seed system settings
  // Cloud mode defaults to 'multi' (requires login/registration).
  // Local mode defaults to 'local' (single-user, auto-login).
  try {
    const authMode = isCloud ? 'multi' : 'local';
    const defaults: Record<string, string> = {
      'auth.mode': authMode,
      'preview.cacheDir': './data/preview-cache',
      'ai.enabled': 'false',
      'ai.faceRecognition': 'false',
      'ai.defaultProvider': 'openai',
      'log.level': 'info',
      'indexing.ignorePatterns': '.gitkeep,.DS_Store,Thumbs.db,.harbor,desktop.ini,.Spotlight-V100,.Trashes,Icon,*.aae',
      'registration.enabled': 'true',
      'seo.allowCrawlers': 'false',
    };
    for (const [key, value] of Object.entries(defaults)) {
      await db.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: {},
      });
    }
    steps.push({ step: 'Settings', status: 'ok' });
  } catch (err: unknown) {
    steps.push({ step: 'Settings', status: 'error', message: err instanceof Error ? err.message : 'Failed' });
  }

  // Step 4: Seed default metadata field templates
  try {
    const fieldTemplates = [
      { name: 'Title', key: 'title', fieldType: 'text', sortOrder: 1 },
      { name: 'Description', key: 'description', fieldType: 'textarea', sortOrder: 2 },
      { name: 'Tags', key: 'tags', fieldType: 'multiselect', sortOrder: 3 },
      {
        name: 'Adult Content', key: 'adult_content', fieldType: 'multiselect', sortOrder: 4,
        options: [
          { value: 'nudity', label: 'Nudity' },
          { value: 'sexual_acts', label: 'Sexual Acts' },
          { value: 'suggestive', label: 'Suggestive' },
        ],
        showInSearch: true, hiddenByDefault: true,
      },
      { name: 'People', key: 'people', fieldType: 'people', sortOrder: 5, showInSearch: true },
    ];
    for (const tmpl of fieldTemplates) {
      await db.metadataFieldTemplate.upsert({
        where: { key: tmpl.key },
        create: {
          name: tmpl.name,
          key: tmpl.key,
          fieldType: tmpl.fieldType,
          sortOrder: tmpl.sortOrder,
          options: (tmpl as { options?: unknown }).options ?? [],
          showInSearch: (tmpl as { showInSearch?: boolean }).showInSearch ?? false,
          hiddenByDefault: (tmpl as { hiddenByDefault?: boolean }).hiddenByDefault ?? false,
        },
        update: {},
      });
    }
    steps.push({ step: 'Metadata fields', status: 'ok' });
  } catch (err: unknown) {
    steps.push({ step: 'Metadata fields', status: 'error', message: err instanceof Error ? err.message : 'Failed' });
  }

  // Step 5: Search foundation SQL (triggers + indexes)
  try {
    // Create the search vector trigger function
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION file_search_vector_update() RETURNS trigger AS $$
      DECLARE
        tag_names TEXT;
        people_names TEXT;
        people_arr jsonb;
        elem jsonb;
      BEGIN
        SELECT string_agg(t.name, ' ') INTO tag_names
          FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = NEW.id;
        people_names := '';
        people_arr := NEW.meta -> 'fields' -> 'people';
        IF people_arr IS NOT NULL AND jsonb_typeof(people_arr) = 'array' THEN
          FOR elem IN SELECT * FROM jsonb_array_elements(people_arr) LOOP
            IF elem ->> 'name' IS NOT NULL THEN
              people_names := people_names || ' ' || (elem ->> 'name');
            END IF;
          END LOOP;
        END IF;
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'caption', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'altText', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'aiTitle', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'aiDescription', '')), 'C') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'ocrText', '')), 'C') ||
          setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'transcript', '')), 'C') ||
          setweight(to_tsvector('english', coalesce(tag_names, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(people_names, '')), 'B');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Attach trigger
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS files_search_vector_trigger ON files`);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER files_search_vector_trigger BEFORE INSERT OR UPDATE ON files
      FOR EACH ROW EXECUTE FUNCTION file_search_vector_update()
    `);

    // Tag-sync trigger
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION file_tags_search_vector_sync() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          UPDATE files SET updated_at = now() WHERE id = OLD.file_id;
        ELSE
          UPDATE files SET updated_at = now() WHERE id = NEW.file_id;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS file_tags_search_sync ON file_tags`);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER file_tags_search_sync AFTER INSERT OR DELETE ON file_tags
      FOR EACH ROW EXECUTE FUNCTION file_tags_search_vector_sync()
    `);

    // GIN indexes
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_files_search_vector ON files USING GIN (search_vector)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_files_name_trgm ON files USING GIN (name gin_trgm_ops)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_files_title_trgm ON files USING GIN (title gin_trgm_ops)`);

    steps.push({ step: 'Search indexes', status: 'ok' });
  } catch (err: unknown) {
    steps.push({ step: 'Search indexes', status: 'error', message: err instanceof Error ? err.message : 'Failed' });
    // Non-fatal — search works but slower without materialized vector
  }

  return NextResponse.json({ message: 'Database initialized successfully', steps });
}
