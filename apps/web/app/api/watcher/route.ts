import { NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/lib/auth';
import { isCloudMode } from '@/lib/deployment';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (isCloudMode) {
    return NextResponse.json({ watching: [], mode: 'cloud' });
  }

  const { fileWatcher } = await import('@harbor/jobs');
  return NextResponse.json({ watching: fileWatcher.getWatchedRoots() });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.archive_roots', 'access');
  if (denied) return denied;

  if (isCloudMode) {
    return NextResponse.json({ watching: [], mode: 'cloud', message: 'File watcher not available in cloud mode' });
  }

  const { fileWatcher } = await import('@harbor/jobs');
  await fileWatcher.start();
  return NextResponse.json({ watching: fileWatcher.getWatchedRoots() });
}
