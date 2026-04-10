import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';
import { hasSecret } from '@/lib/secrets';

/**
 * GET /api/auth/dropbox/status — Check Dropbox configuration and connection state.
 * Reads secrets from encrypted DB store (with env fallback).
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const [hasKey, hasSecretKey] = await Promise.all([
    hasSecret('dropbox.appKey'),
    hasSecret('dropbox.appSecret'),
  ]);

  const configured = hasKey && hasSecretKey;

  const token = await db.providerToken.findUnique({
    where: { userId_providerType: { userId: auth.userId, providerType: 'DROPBOX' } },
    select: { id: true, expiresAt: true, createdAt: true, metadata: true },
  });

  const meta = (token?.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    configured,
    connected: !!token,
    expiresAt: token?.expiresAt?.toISOString() ?? null,
    connectedAt: token?.createdAt?.toISOString() ?? null,
    accountInfo: token ? {
      displayName: meta.displayName ?? null,
      email: meta.email ?? null,
      accountType: meta.accountType ?? null,
      rootInfoTag: meta.rootInfoTag ?? null,
      hasTeamSpace: meta.rootInfoTag === 'team',
    } : null,
  });
}
