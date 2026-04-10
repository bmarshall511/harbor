import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth-service';
import type { AuthContext } from './types';

// Mock the UserRepository
vi.mock('@harbor/database', () => {
  const localUser = {
    id: 'local-user-id',
    username: 'local',
    displayName: 'Local User',
    isLocalUser: true,
    isActive: true,
    roleAssignments: [
      {
        role: {
          id: 'owner-role-id',
          name: 'Owner',
          systemRole: 'OWNER',
          permissions: [
            { resource: 'files', action: 'read' },
            { resource: 'files', action: 'write' },
            { resource: 'files', action: 'delete' },
            { resource: 'metadata', action: 'read' },
            { resource: 'metadata', action: 'write' },
            { resource: 'admin', action: 'manage' },
          ],
        },
      },
    ],
  };

  return {
    UserRepository: vi.fn().mockImplementation(() => ({
      ensureLocalUser: vi.fn().mockResolvedValue(localUser),
      findById: vi.fn().mockResolvedValue(null),
      findByUsername: vi.fn().mockResolvedValue(null),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getLocalUser: vi.fn().mockResolvedValue(localUser),
    })),
  };
});

describe('AuthService', () => {
  describe('local mode', () => {
    it('returns local user context without token', async () => {
      const service = new AuthService('test-secret', 'local');
      const ctx = await service.getAuthContext();

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe('local-user-id');
      expect(ctx!.username).toBe('local');
      expect(ctx!.isLocalUser).toBe(true);
      expect(ctx!.roles).toHaveLength(1);
      expect(ctx!.roles[0].systemRole).toBe('OWNER');
    });

    it('returns local user context even with invalid token', async () => {
      const service = new AuthService('test-secret', 'local');
      const ctx = await service.getAuthContext('garbage-token');

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe('local-user-id');
    });

    it('local user has expected permissions', async () => {
      const service = new AuthService('test-secret', 'local');
      const ctx = await service.getAuthContext();

      const permissions = ctx!.roles[0].permissions;
      expect(permissions).toContainEqual({ resource: 'files', action: 'read' });
      expect(permissions).toContainEqual({ resource: 'files', action: 'write' });
      expect(permissions).toContainEqual({ resource: 'files', action: 'delete' });
      expect(permissions).toContainEqual({ resource: 'metadata', action: 'write' });
    });
  });

  describe('multi mode', () => {
    it('returns null without token', async () => {
      const service = new AuthService('test-secret', 'multi');
      const ctx = await service.getAuthContext();

      expect(ctx).toBeNull();
    });

    it('returns null with invalid token', async () => {
      const service = new AuthService('test-secret', 'multi');
      const ctx = await service.getAuthContext('garbage-token');

      expect(ctx).toBeNull();
    });

    it('returns null with expired token', async () => {
      const service = new AuthService('test-secret', 'multi');
      // A malformed JWT should not crash, just return null
      const ctx = await service.getAuthContext('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid');

      expect(ctx).toBeNull();
    });
  });

  describe('login', () => {
    it('returns null for nonexistent user', async () => {
      const service = new AuthService('test-secret', 'multi');
      const result = await service.login('nonexistent', 'password');

      expect(result).toBeNull();
    });
  });
});
