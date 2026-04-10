import { db } from '../client';

/**
 * Known setting keys with their types and defaults.
 * This is the canonical source of truth for what settings exist.
 */
export const SETTING_DEFAULTS: Record<string, string> = {
  'auth.mode': 'local',
  'preview.cacheDir': './data/preview-cache',
  'ai.enabled': 'false',
  'ai.faceRecognition': 'false',
  'ai.defaultProvider': 'openai',
  'log.level': 'info',
  'dropbox.redirectUri': 'http://localhost:3000/api/auth/dropbox/callback',
  'indexing.ignorePatterns': '.gitkeep,.DS_Store,Thumbs.db,.harbor,desktop.ini,.Spotlight-V100,.Trashes,Icon,*.aae',
  'registration.enabled': 'true',
  'seo.allowCrawlers': 'false',
};

export class SettingsRepository {
  /** Get a single setting. Falls back to SETTING_DEFAULTS, then to provided fallback. */
  async get(key: string, fallback?: string): Promise<string> {
    const row = await db.systemSetting.findUnique({ where: { key } });
    if (row) return row.value;
    return SETTING_DEFAULTS[key] ?? fallback ?? '';
  }

  /** Get a boolean setting. */
  async getBool(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val === 'true' || val === '1';
  }

  /** Set a single setting. Creates or updates. */
  async set(key: string, value: string): Promise<void> {
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** Get multiple settings at once. */
  async getMany(keys: string[]): Promise<Record<string, string>> {
    const rows = await db.systemSetting.findMany({ where: { key: { in: keys } } });
    const result: Record<string, string> = {};
    for (const key of keys) {
      const row = rows.find((r) => r.key === key);
      result[key] = row?.value ?? SETTING_DEFAULTS[key] ?? '';
    }
    return result;
  }

  /** Get all settings (for admin/settings page). */
  async getAll(): Promise<Record<string, string>> {
    const rows = await db.systemSetting.findMany();
    const result: Record<string, string> = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Delete a setting (reverts to default). */
  async delete(key: string): Promise<void> {
    await db.systemSetting.deleteMany({ where: { key } });
  }
}
