import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes a password and verifies it', async () => {
    const password = 'my-secure-password';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(20);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('produces different hashes for same password', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2); // Different salts
  });
});
