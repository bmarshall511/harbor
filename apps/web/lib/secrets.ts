import { SecretsRepository } from '@harbor/database';

const SESSION_SECRET = process.env.HARBOR_SESSION_SECRET ?? 'change-me-in-production';
const secrets = new SecretsRepository(SESSION_SECRET);

/**
 * Get a secret, checking the encrypted DB store first, then falling back to env.
 * This allows secrets to be configured in either place during transition.
 */
export async function getSecret(key: string): Promise<string | null> {
  // Try encrypted DB store first
  const dbValue = await secrets.get(key);
  if (dbValue) return dbValue;

  // Fall back to env vars for backward compatibility
  const envMap: Record<string, string | undefined> = {
    'dropbox.appKey': process.env.DROPBOX_APP_KEY,
    'dropbox.appSecret': process.env.DROPBOX_APP_SECRET,
    'openai.apiKey': process.env.OPENAI_API_KEY,
    'anthropic.apiKey': process.env.ANTHROPIC_API_KEY,
  };

  return envMap[key] || null;
}

/**
 * Check if a secret is configured (in DB or env).
 */
export async function hasSecret(key: string): Promise<boolean> {
  const val = await getSecret(key);
  return !!val;
}
