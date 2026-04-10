import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * POST /api/validate-path — Check if a local path exists and is a directory.
 * Returns { valid, exists, isDirectory, readable, error }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { path: dirPath } = await request.json();

  if (!dirPath || typeof dirPath !== 'string') {
    return NextResponse.json({ valid: false, error: 'Path is required' });
  }

  if (!path.isAbsolute(dirPath)) {
    return NextResponse.json({ valid: false, error: 'Path must be absolute (start with /)' });
  }

  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ valid: false, exists: true, isDirectory: false, error: 'Path exists but is not a directory' });
    }

    // Try to read the directory to verify permissions
    await fs.readdir(dirPath, { withFileTypes: true });

    return NextResponse.json({ valid: true, exists: true, isDirectory: true, readable: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ valid: false, exists: false, error: 'Directory does not exist' });
    }
    if (code === 'EACCES') {
      return NextResponse.json({ valid: false, exists: true, error: 'Permission denied — Harbor cannot read this directory' });
    }
    return NextResponse.json({ valid: false, error: `Cannot access path: ${code ?? 'unknown error'}` });
  }
}
