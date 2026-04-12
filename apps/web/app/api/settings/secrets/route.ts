import { NextResponse } from 'next/server';
import { SecretsRepository } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const SESSION_SECRET = process.env.HARBOR_SESSION_SECRET ?? 'change-me-in-production';
const secrets = new SecretsRepository(SESSION_SECRET);

/** Known secret keys that can be managed through this API. */
const ALLOWED_SECRETS = [
  'dropbox.appKey',
  'dropbox.appSecret',
  'openai.apiKey',
  'anthropic.apiKey',
  'gemini.apiKey',
];

/**
 * GET /api/settings/secrets — Returns which secrets are set (never their values).
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const status = await secrets.getStatus(ALLOWED_SECRETS);
  return NextResponse.json(status);
}

/**
 * PATCH /api/settings/secrets — Set or clear secrets.
 * Body: { "dropbox.appKey": "value" } to set, { "dropbox.appKey": null } to clear.
 * Never returns the secret values back.
 */
export async function PATCH(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const body = await request.json();

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_SECRETS.includes(key)) continue;

    if (value === null || value === '') {
      await secrets.clear(key);
    } else if (typeof value === 'string') {
      await secrets.set(key, value);
    }
  }

  const status = await secrets.getStatus(ALLOWED_SECRETS);
  return NextResponse.json(status);
}
