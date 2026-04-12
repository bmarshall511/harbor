import { NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/lib/auth';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * POST /api/browse-local — Browse local filesystem directories for the folder picker.
 * Body: { path?: string }
 * Returns: { folders: [{ name, path }], currentPath: string, parentPath: string | null }
 *
 * Security: only lists directories (not files), starting from the user's home directory.
 * Does not allow browsing above /Users or system directories.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.archive_roots', 'access');
  if (denied) return denied;

  const { path: dirPath } = await request.json().catch(() => ({ path: '' }));

  // Default to home directory
  const browsePath = dirPath || os.homedir();

  // Security: resolve to absolute and prevent system directory browsing
  const resolved = path.resolve(browsePath);
  const forbidden = ['/', '/bin', '/sbin', '/usr', '/etc', '/var', '/tmp', '/proc', '/sys', '/dev'];
  if (forbidden.includes(resolved)) {
    return NextResponse.json({ message: 'Cannot browse system directories' }, { status: 403 });
  }

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const folders: Array<{ name: string; path: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // Skip hidden
      folders.push({ name: entry.name, path: path.join(resolved, entry.name) });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolved);
    const canGoUp = parentPath !== resolved && !forbidden.includes(parentPath);

    return NextResponse.json({
      folders: folders.slice(0, 200),
      currentPath: resolved,
      parentPath: canGoUp ? parentPath : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cannot browse directory';
    return NextResponse.json({ message }, { status: 400 });
  }
}
