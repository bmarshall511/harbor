import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth-service';
import { PermissionService } from './permission-service';
import type { AuthContext } from './types';

/**
 * Integration tests for auth flows used in API routes.
 * Tests the full auth → permission → capability chain.
 */

// Mock UserRepository to simulate different user scenarios
vi.mock('@harbor/database', () => {
  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    isLocalUser: false,
    isActive: true,
    passwordHash: '$2a$12$fakehash',
    roleAssignments: [{
      role: {
        id: 'role-1',
        name: 'Editor',
        systemRole: 'EDITOR',
        permissions: [
          { resource: 'files', action: 'read' },
          { resource: 'files', action: 'write' },
          { resource: 'metadata', action: 'read' },
          { resource: 'metadata', action: 'write' },
          { resource: 'tags', action: 'read' },
          { resource: 'tags', action: 'write' },
          { resource: 'relations', action: 'read' },
          { resource: 'relations', action: 'write' },
        ],
      },
    }],
    ...overrides,
  });

  const localUser = makeUser({
    id: 'local-1',
    username: 'local',
    displayName: 'Local User',
    isLocalUser: true,
    roleAssignments: [{
      role: {
        id: 'role-owner',
        name: 'Owner',
        systemRole: 'OWNER',
        permissions: [
          { resource: 'files', action: 'read' },
          { resource: 'files', action: 'write' },
          { resource: 'files', action: 'delete' },
          { resource: 'metadata', action: 'read' },
          { resource: 'metadata', action: 'write' },
          { resource: 'tags', action: 'read' },
          { resource: 'tags', action: 'write' },
          { resource: 'tags', action: 'delete' },
          { resource: 'relations', action: 'read' },
          { resource: 'relations', action: 'write' },
          { resource: 'relations', action: 'delete' },
          { resource: 'admin', action: 'manage' },
          { resource: 'archive_roots', action: 'manage' },
        ],
      },
    }],
  });

  return {
    UserRepository: vi.fn().mockImplementation(() => ({
      ensureLocalUser: vi.fn().mockResolvedValue(localUser),
      findById: vi.fn().mockResolvedValue(null),
      findByUsername: vi.fn().mockResolvedValue(null),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
    })),
  };
});

describe('Auth + Permission integration', () => {
  const permSvc = new PermissionService();

  describe('local mode full flow', () => {
    it('auto-authenticates and has full permissions', async () => {
      const authService = new AuthService('test-secret', 'local');
      const ctx = await authService.getAuthContext();
      expect(ctx).not.toBeNull();

      // Should be able to do everything
      expect(permSvc.hasPermission(ctx!, 'files', 'read')).toBe(true);
      expect(permSvc.hasPermission(ctx!, 'files', 'write')).toBe(true);
      expect(permSvc.hasPermission(ctx!, 'files', 'delete')).toBe(true);
      expect(permSvc.hasPermission(ctx!, 'admin', 'manage')).toBe(true);
      expect(permSvc.hasPermission(ctx!, 'archive_roots', 'manage')).toBe(true);
      expect(permSvc.isAdmin(ctx!)).toBe(true);
    });

    it('can perform all file operations on full-capability root', async () => {
      const authService = new AuthService('test-secret', 'local');
      const ctx = await authService.getAuthContext();
      const fullCaps = ['READ', 'WRITE', 'DELETE', 'MOVE', 'RENAME', 'CREATE_FOLDERS', 'SEARCH'] as const;

      expect(permSvc.canPerformFileOperation(ctx!, 'READ', [...fullCaps])).toBe(true);
      expect(permSvc.canPerformFileOperation(ctx!, 'WRITE', [...fullCaps])).toBe(true);
      expect(permSvc.canPerformFileOperation(ctx!, 'DELETE', [...fullCaps])).toBe(true);
      expect(permSvc.canPerformFileOperation(ctx!, 'MOVE', [...fullCaps])).toBe(true);
    });
  });

  describe('multi mode requires token', () => {
    it('rejects without token', async () => {
      const authService = new AuthService('test-secret', 'multi');
      const ctx = await authService.getAuthContext();
      expect(ctx).toBeNull();
    });

    it('rejects garbage token', async () => {
      const authService = new AuthService('test-secret', 'multi');
      const ctx = await authService.getAuthContext('not-a-jwt');
      expect(ctx).toBeNull();
    });
  });

  describe('archive root access control', () => {
    it('non-admin cannot access private root without role access', () => {
      const editorCtx: AuthContext = {
        userId: 'editor-1',
        username: 'editor',
        displayName: 'Editor',
        isLocalUser: false,
        roles: [{
          id: 'role-editor',
          name: 'Editor',
          systemRole: 'EDITOR',
          permissions: [{ resource: 'files', action: 'read' }],
        }],
      };

      const privateRoot = { isPrivate: true, accesses: [{ roleId: 'role-admin' }] };
      const userRoleIds = new Set(editorCtx.roles.map((r) => r.id));
      const hasAccess = permSvc.isAdmin(editorCtx) || privateRoot.accesses.some((a) => userRoleIds.has(a.roleId));
      expect(hasAccess).toBe(false);
    });

    it('admin can access private root regardless', () => {
      const adminCtx: AuthContext = {
        userId: 'admin-1',
        username: 'admin',
        displayName: 'Admin',
        isLocalUser: false,
        roles: [{
          id: 'role-admin',
          name: 'Admin',
          systemRole: 'ADMIN',
          permissions: [{ resource: 'admin', action: 'manage' }],
        }],
      };

      expect(permSvc.isAdmin(adminCtx)).toBe(true);
    });
  });

  describe('mutation permission matrix', () => {
    const viewer: AuthContext = {
      userId: 'v1', username: 'viewer', displayName: 'Viewer', isLocalUser: false,
      roles: [{ id: 'rv', name: 'Viewer', systemRole: 'VIEWER', permissions: [
        { resource: 'files', action: 'read' },
        { resource: 'metadata', action: 'read' },
        { resource: 'tags', action: 'read' },
        { resource: 'relations', action: 'read' },
      ]}],
    };

    const editor: AuthContext = {
      userId: 'e1', username: 'editor', displayName: 'Editor', isLocalUser: false,
      roles: [{ id: 're', name: 'Editor', systemRole: 'EDITOR', permissions: [
        { resource: 'files', action: 'read' },
        { resource: 'files', action: 'write' },
        { resource: 'metadata', action: 'write' },
        { resource: 'tags', action: 'write' },
        { resource: 'relations', action: 'write' },
      ]}],
    };

    // Archive root CRUD
    it('viewer cannot create archive roots', () => {
      expect(permSvc.hasPermission(viewer, 'archive_roots', 'manage')).toBe(false);
    });
    it('editor cannot create archive roots', () => {
      expect(permSvc.hasPermission(editor, 'archive_roots', 'manage')).toBe(false);
    });

    // Tag mutations
    it('viewer cannot add tags', () => {
      expect(permSvc.hasPermission(viewer, 'tags', 'write')).toBe(false);
    });
    it('editor can add tags', () => {
      expect(permSvc.hasPermission(editor, 'tags', 'write')).toBe(true);
    });

    // Relation mutations
    it('viewer cannot create relations', () => {
      expect(permSvc.hasPermission(viewer, 'relations', 'write')).toBe(false);
    });
    it('editor can create relations', () => {
      expect(permSvc.hasPermission(editor, 'relations', 'write')).toBe(true);
    });

    // File move
    it('viewer cannot move files', () => {
      expect(permSvc.hasPermission(viewer, 'files', 'write')).toBe(false);
    });
    it('editor can move files', () => {
      expect(permSvc.hasPermission(editor, 'files', 'write')).toBe(true);
    });

    // File delete
    it('viewer cannot delete files', () => {
      expect(permSvc.hasPermission(viewer, 'files', 'delete')).toBe(false);
    });
    it('editor cannot delete files', () => {
      expect(permSvc.hasPermission(editor, 'files', 'delete')).toBe(false);
    });
  });
});
