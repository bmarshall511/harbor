import { NextResponse } from 'next/server';
import { fileWatcher } from '@harbor/jobs';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/watcher — Return current watcher status.
 * POST /api/watcher — Start or restart file watchers for all active local roots.
 */

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    watching: fileWatcher.getWatchedRoots(),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  await fileWatcher.start();

  return NextResponse.json({
    watching: fileWatcher.getWatchedRoots(),
  });
}
