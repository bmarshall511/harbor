import { z } from 'zod';

/**
 * Env schema — only true secrets, infrastructure bootstrap, and runtime values.
 * Product configuration lives in the database (system_settings table).
 */
const envSchema = z.object({
  // Infrastructure
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Secrets
  HARBOR_SESSION_SECRET: z.string().min(16).default('change-me-in-production'),

  // Note: Dropbox and AI API keys are stored in the encrypted
  // secrets table (configured via Settings UI), NOT in env vars.

  // Runtime bootstrap (only needed before DB is available)
  HARBOR_PORT: z.coerce.number().default(3000),
  HARBOR_HOST: z.string().default('localhost'),
});

export type HarborEnv = z.infer<typeof envSchema>;

let _env: HarborEnv | null = null;

export function env(): HarborEnv {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const formatted = result.error.flatten().fieldErrors;
      const missing = Object.entries(formatted)
        .map(([key, errors]) => `  ${key}: ${errors?.join(', ')}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${missing}`);
    }
    _env = result.data;
  }
  return _env;
}
