import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * POST /api/auth/dropbox/disconnect — Remove stored Dropbox tokens.
 * Forces a clean reauth on next connect.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'archive_roots', 'manage');
  if (denied) return denied;

  await db.providerToken.deleteMany({
    where: { providerType: 'DROPBOX', userId: auth.userId },
  });

  return NextResponse.json({ ok: true, message: 'Dropbox disconnected. Reconnect to get a fresh token.' });
}
