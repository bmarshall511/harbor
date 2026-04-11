import { NextResponse } from 'next/server';
import { SettingsRepository, SETTING_DEFAULTS } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

const settingsRepo = new SettingsRepository();

/** GET /api/settings — Return all settings (merged with defaults). */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const settings = await settingsRepo.getAll();
    return NextResponse.json(settings);
  } catch (error: unknown) {
    console.error('[Settings] Failed to load settings:', error);
    // Return defaults so the app can still boot even if DB is momentarily unavailable
    return NextResponse.json(SETTING_DEFAULTS);
  }
}

/** PATCH /api/settings — Update one or more settings. Admin only. */
export async function PATCH(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const body = await request.json();

  // body is Record<string, string>
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue;
    // Only allow known setting keys
    if (key in SETTING_DEFAULTS) {
      await settingsRepo.set(key, value);
    }
  }

  const updated = await settingsRepo.getAll();
  return NextResponse.json(updated);
}
