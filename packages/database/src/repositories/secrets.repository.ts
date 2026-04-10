import { db } from '../client';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encrypted secret storage backed by the system_settings table.
 * Uses AES-256-GCM with a key derived from HARBOR_SESSION_SECRET.
 * Secret keys are prefixed with "secret." to distinguish from plain settings.
 *
 * Security model:
 * - Secrets are encrypted at rest in the database
 * - The encryption key is derived from HARBOR_SESSION_SECRET (env-only)
 * - Secrets are never returned to the client in plaintext after save
 * - The API returns only { set: true/false } for each secret
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'harbor-secret-salt', KEY_LENGTH);
}

function encrypt(plaintext: string, sessionSecret: string): string {
  const key = deriveKey(sessionSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(ciphertext: string, sessionSecret: string): string {
  const key = deriveKey(sessionSecret);
  const [ivB64, tagB64, encB64] = ciphertext.split(':');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export class SecretsRepository {
  private sessionSecret: string;

  constructor(sessionSecret: string) {
    this.sessionSecret = sessionSecret;
  }

  /** Store an encrypted secret. */
  async set(key: string, value: string): Promise<void> {
    const encrypted = encrypt(value, this.sessionSecret);
    await db.systemSetting.upsert({
      where: { key: `secret.${key}` },
      create: { key: `secret.${key}`, value: encrypted },
      update: { value: encrypted },
    });
  }

  /** Retrieve and decrypt a secret. Returns null if not set. */
  async get(key: string): Promise<string | null> {
    const row = await db.systemSetting.findUnique({ where: { key: `secret.${key}` } });
    if (!row) return null;
    try {
      return decrypt(row.value, this.sessionSecret);
    } catch {
      return null; // Decryption failed (wrong key, corrupted data)
    }
  }

  /** Check if a secret is set (without decrypting). */
  async isSet(key: string): Promise<boolean> {
    const row = await db.systemSetting.findUnique({ where: { key: `secret.${key}` } });
    return !!row;
  }

  /** Clear a secret. */
  async clear(key: string): Promise<void> {
    await db.systemSetting.deleteMany({ where: { key: `secret.${key}` } });
  }

  /** Get the status of multiple secrets (set/unset, never the values). */
  async getStatus(keys: string[]): Promise<Record<string, boolean>> {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: keys.map((k) => `secret.${k}`) } },
      select: { key: true },
    });
    const setKeys = new Set(rows.map((r) => r.key.replace('secret.', '')));
    const result: Record<string, boolean> = {};
    for (const key of keys) {
      result[key] = setKeys.has(key);
    }
    return result;
  }
}
