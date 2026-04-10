import { SecretsRepository } from '@harbor/database';

const SESSION_SECRET = process.env.HARBOR_SESSION_SECRET ?? 'change-me-in-production';
const secrets = new SecretsRepository(SESSION_SECRET);

/**
 * Get a secret, checking the encrypted DB store first, then falling back to env.
 * This allows secrets to be configured in either place during transition.
 */
export async function getSecret(key: string): Promise<string | null> {
  return secrets.get(key);
}

/**
 * Check if a secret is configured (in DB or env).
 */
export async function hasSecret(key: string): Promise<boolean> {
  const val = await getSecret(key);
  return !!val;
}
