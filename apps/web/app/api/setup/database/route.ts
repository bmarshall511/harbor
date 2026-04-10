import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * GET /api/setup/database — Check if the database is initialized.
 * POST /api/setup/database — Initialize the database (schema + seed + search indexes).
 *
 * This is an unauthenticated endpoint — it ONLY works when the database
 * has no tables yet (first-time setup). Once tables exist, it returns
 * 403 to prevent re-initialization.
 */

async function isDatabaseInitialized(): Promise<boolean> {
  try {
    // Try to import Prisma and query a known table. If it throws
    // (table doesn't exist), the DB is not initialized.
    const { db } = await import('@harbor/database');
    await db.systemSetting.count();
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const initialized = await isDatabaseInitialized();
  return NextResponse.json({ initialized });
}

export async function POST() {
  // Safety: block if already initialized
  const initialized = await isDatabaseInitialized();
  if (initialized) {
    return NextResponse.json(
      { message: 'Database is already initialized. This endpoint only works on first setup.' },
      { status: 403 },
    );
  }

  const steps: Array<{ step: string; status: 'ok' | 'error'; message?: string }> = [];

  // Find the schema path. In dev it's in the workspace root; in
  // production builds it may be relative to the web app.
  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    return NextResponse.json({
      message: 'Could not find Prisma schema file. Run setup from the project root.',
      steps,
    }, { status: 500 });
  }

  // Step 1: prisma db push
  try {
    execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate`, {
      timeout: 60_000,
      env: { ...process.env },
      stdio: 'pipe',
    });
    steps.push({ step: 'Schema push', status: 'ok' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    steps.push({ step: 'Schema push', status: 'error', message: msg });
    return NextResponse.json({ message: 'Schema push failed', steps }, { status: 500 });
  }

  // Step 2: Generate Prisma client
  try {
    execSync(`npx prisma generate --schema="${schemaPath}"`, {
      timeout: 30_000,
      env: { ...process.env },
      stdio: 'pipe',
    });
    steps.push({ step: 'Client generation', status: 'ok' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    steps.push({ step: 'Client generation', status: 'error', message: msg });
    // Non-fatal — client may already be generated from build step
  }

  // Step 3: Seed (roles, local user, system settings)
  try {
    // Run the seed script via tsx/ts-node. The seed file uses the
    // Prisma client directly with nested creates for role permissions.
    const seedPath = path.resolve(schemaPath, '..', '..', 'src', 'seed.ts');
    if (fs.existsSync(seedPath)) {
      execSync(`npx tsx "${seedPath}"`, {
        timeout: 30_000,
        env: { ...process.env },
        stdio: 'pipe',
      });
    }
    steps.push({ step: 'Seed data', status: 'ok' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    steps.push({ step: 'Seed data', status: 'error', message: msg });
    return NextResponse.json({ message: 'Seed failed', steps }, { status: 500 });
  }

  // Step 4: Search foundation SQL (triggers + indexes)
  try {
    const sqlPath = path.resolve(schemaPath, '..', 'sql', '001_search_foundation.sql');
    if (fs.existsSync(sqlPath)) {
      const { db } = await import('@harbor/database');
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      // Split on semicolons and execute each statement
      const statements = sql
        .split(/;\s*$/m)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
        try {
          await db.$executeRawUnsafe(stmt);
        } catch {
          // Some statements may fail if already applied — continue
        }
      }
      steps.push({ step: 'Search indexes', status: 'ok' });
    } else {
      steps.push({ step: 'Search indexes', status: 'ok', message: 'SQL file not found — skipped (not critical for first run)' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    steps.push({ step: 'Search indexes', status: 'error', message: msg });
    // Non-fatal — search will work but slower
  }

  return NextResponse.json({
    message: 'Database initialized successfully',
    steps,
  });
}

function resolveSchemaPath(): string | null {
  // Try common locations relative to the project
  const candidates = [
    path.resolve(process.cwd(), 'packages/database/prisma/schema.prisma'),
    path.resolve(process.cwd(), '../../packages/database/prisma/schema.prisma'),
    path.resolve(__dirname, '../../../../packages/database/prisma/schema.prisma'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
