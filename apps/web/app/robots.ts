import type { MetadataRoute } from 'next';

/**
 * Dynamic robots.txt — blocks all crawlers by default.
 *
 * The `seo.allowCrawlers` setting (stored in the DB) controls
 * whether search engines and AI scrapers are allowed to index the
 * site. When disabled (the default for a private archive app),
 * the robots.txt disallows all user agents.
 *
 * Admins can toggle this in Settings > General.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Try to read the setting from the DB. If the DB is unavailable
  // (first deploy, migration in progress), default to blocking.
  let allowCrawlers = false;
  try {
    const { SettingsRepository } = await import('@harbor/database');
    const settingsRepo = new SettingsRepository();
    const val = await settingsRepo.get('seo.allowCrawlers');
    allowCrawlers = val === 'true';
  } catch {
    // DB not available — keep crawlers blocked
  }

  if (allowCrawlers) {
    return {
      rules: { userAgent: '*', allow: '/' },
    };
  }

  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
