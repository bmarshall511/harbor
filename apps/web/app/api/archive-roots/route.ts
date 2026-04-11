import { NextResponse } from 'next/server';
import { ArchiveRootRepository } from '@harbor/database';
import { requireAuth, requirePermission, canAccessRoot } from '@/lib/auth';
import { isLocalMode } from '@/lib/deployment';

const repo = new ArchiveRootRepository();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const roots = await repo.findAll();
  const visible = roots.filter((r) => canAccessRoot(auth, r));

  return NextResponse.json(
    visible.map((r) => ({
      id: r.id,
      name: r.name,
      providerType: r.providerType,
      rootPath: r.rootPath,
      isPrivate: r.isPrivate,
      isActive: r.isActive,
      capabilities: r.capabilities,
    })),
  );
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  try {
    const body = await request.json();
    const root = await repo.create({
      name: body.name,
      providerType: body.providerType,
      rootPath: body.rootPath,
      isPrivate: body.isPrivate ?? false,
      capabilities: body.capabilities ?? ['READ'],
      config: body.config ?? {},
    });

    // Auto-start file watcher for new local roots
    if (root.providerType === 'LOCAL_FILESYSTEM') {
      if (isLocalMode && root.providerType === 'LOCAL_FILESYSTEM') {
        import('@harbor/jobs').then(({ fileWatcher }) => {
          fileWatcher.watchRoot(root.id, root.rootPath);
        }).catch(() => {});
      }
    }

    return NextResponse.json(root, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}
