import { NextResponse } from 'next/server';
import { SettingsRepository } from '@harbor/database';

const settingsRepo = new SettingsRepository();

/** Public settings needed by the login page — no auth required. */
const PUBLIC_KEYS = ['auth.mode', 'registration.enabled'] as const;

export async function GET() {
  try {
    const all = await settingsRepo.getAll();
    const result: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) {
      if (key in all) result[key] = all[key];
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ 'auth.mode': 'local', 'registration.enabled': 'true' });
  }
}
