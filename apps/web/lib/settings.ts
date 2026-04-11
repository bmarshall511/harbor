import { SettingsRepository, SETTING_DEFAULTS } from '@harbor/database';
import { isCloudMode } from '@/lib/deployment';

const settingsRepo = new SettingsRepository();

let _cache: Record<string, string> | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Get a Harbor system setting.
 * Reads from database with a 30-second in-memory cache.
 * Falls back to env vars for bootstrap (first run before DB is seeded),
 * then to hardcoded defaults.
 */
export async function getSetting(key: string): Promise<string> {
  let value: string;

  // Try cache first
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    value = _cache[key] ?? SETTING_DEFAULTS[key] ?? '';
  } else {
    try {
      _cache = await settingsRepo.getAll();
      _cacheTime = Date.now();
      value = _cache[key] ?? SETTING_DEFAULTS[key] ?? '';
    } catch {
      // Database not available (first run, migration pending, etc.)
      // Fall back to env for bootstrap values
      value = getEnvFallback(key);
    }
  }

  return applyCloudOverrides(key, value);
}

export async function getSettingBool(key: string): Promise<boolean> {
  const val = await getSetting(key);
  return val === 'true' || val === '1';
}

/** Invalidate the settings cache (call after PATCH /api/settings). */
export function invalidateSettingsCache(): void {
  _cache = null;
  _cacheTime = 0;
}

/**
 * Env fallback for bootstrap — only used when the DB is unreachable.
 * Maps setting keys to their legacy env variable names.
 */
function getEnvFallback(key: string): string {
  const envMap: Record<string, string | undefined> = {
    'auth.mode': process.env.HARBOR_AUTH_MODE,
    'preview.cacheDir': process.env.HARBOR_PREVIEW_CACHE_DIR,
    'ai.enabled': process.env.HARBOR_AI_ENABLED,
    'ai.faceRecognition': process.env.HARBOR_FACE_RECOGNITION_ENABLED,
    'log.level': process.env.LOG_LEVEL,
    // dropbox.redirectUri is always derived from the request origin — no env var needed
  };

  return envMap[key] ?? SETTING_DEFAULTS[key] ?? '';
}

/**
 * On serverless (Vercel), the only writable directory is /tmp.
 * Override the default preview cache path so fs.mkdir/writeFile work.
 */
function applyCloudOverrides(key: string, value: string): string {
  if (key === 'preview.cacheDir' && isCloudMode && value === './data/preview-cache') {
    return '/tmp/harbor-cache';
  }
  return value;
}
