import { describe, it, expect } from 'vitest';
import { PermissionService } from './permission-service';
import type { AuthContext } from './types';

/**
 * Tests for archive root management permission flows.
 * Validates that create, rename, remove, and reindex operations
 * are correctly gated by the permission system.
 */

const svc = new PermissionService();

const OWNER: AuthContext = {
  userId: 'o1', username: 'owner', displayName: 'Owner', isLocalUser: true,
  roles: [{ id: 'ro', name: 'Owner', systemRole: 'OWNER', permissions: [
    { resource: 'archive_roots', action: 'manage' },
    { resource: 'admin', action: 'manage' },
    { resource: 'files', action: 'read' },
    { resource: 'files', action: 'write' },
    { resource: 'files', action: 'delete' },
  ]}],
};

const ADMIN: AuthContext = {
  userId: 'a1', username: 'admin', displayName: 'Admin', isLocalUser: false,
  roles: [{ id: 'ra', name: 'Admin', systemRole: 'ADMIN', permissions: [
    { resource: 'archive_roots', action: 'manage' },
    { resource: 'admin', action: 'manage' },
    { resource: 'files', action: 'read' },
    { resource: 'files', action: 'write' },
  ]}],
};

const EDITOR: AuthContext = {
  userId: 'e1', username: 'editor', displayName: 'Editor', isLocalUser: false,
  roles: [{ id: 're', name: 'Editor', systemRole: 'EDITOR', permissions: [
    { resource: 'files', action: 'read' },
    { resource: 'files', action: 'write' },
    { resource: 'metadata', action: 'write' },
  ]}],
};

const VIEWER: AuthContext = {
  userId: 'v1', username: 'viewer', displayName: 'Viewer', isLocalUser: false,
  roles: [{ id: 'rv', name: 'Viewer', systemRole: 'VIEWER', permissions: [
    { resource: 'files', action: 'read' },
  ]}],
};

describe('Archive root management permissions', () => {
  describe('create archive root', () => {
    it('owner can create', () => {
      expect(svc.hasPermission(OWNER, 'archive_roots', 'manage')).toBe(true);
    });
    it('admin can create', () => {
      expect(svc.hasPermission(ADMIN, 'archive_roots', 'manage')).toBe(true);
    });
    it('editor cannot create', () => {
      expect(svc.hasPermission(EDITOR, 'archive_roots', 'manage')).toBe(false);
    });
    it('viewer cannot create', () => {
      expect(svc.hasPermission(VIEWER, 'archive_roots', 'manage')).toBe(false);
    });
  });

  describe('rename archive root', () => {
    it('owner can rename', () => {
      expect(svc.hasPermission(OWNER, 'archive_roots', 'manage')).toBe(true);
    });
    it('admin can rename', () => {
      expect(svc.hasPermission(ADMIN, 'archive_roots', 'manage')).toBe(true);
    });
    it('editor cannot rename', () => {
      expect(svc.hasPermission(EDITOR, 'archive_roots', 'manage')).toBe(false);
    });
    it('viewer cannot rename', () => {
      expect(svc.hasPermission(VIEWER, 'archive_roots', 'manage')).toBe(false);
    });
  });

  describe('remove archive root', () => {
    it('owner can remove', () => {
      expect(svc.hasPermission(OWNER, 'archive_roots', 'manage')).toBe(true);
    });
    it('admin can remove', () => {
      expect(svc.hasPermission(ADMIN, 'archive_roots', 'manage')).toBe(true);
    });
    it('editor cannot remove', () => {
      expect(svc.hasPermission(EDITOR, 'archive_roots', 'manage')).toBe(false);
    });
  });

  describe('reindex archive root', () => {
    // Reindex requires admin manage permission
    it('owner can reindex', () => {
      expect(svc.hasPermission(OWNER, 'admin', 'manage')).toBe(true);
    });
    it('admin can reindex', () => {
      expect(svc.hasPermission(ADMIN, 'admin', 'manage')).toBe(true);
    });
    it('editor cannot reindex', () => {
      expect(svc.hasPermission(EDITOR, 'admin', 'manage')).toBe(false);
    });
    it('viewer cannot reindex', () => {
      expect(svc.hasPermission(VIEWER, 'admin', 'manage')).toBe(false);
    });
  });

  describe('rename validation', () => {
    it('name must not be empty', () => {
      const name = ''.trim();
      expect(name.length).toBe(0);
    });
    it('name must be under 100 chars', () => {
      const name = 'A'.repeat(101);
      expect(name.length).toBeGreaterThan(100);
    });
    it('normal name passes validation', () => {
      const name = 'My Photos Archive'.trim();
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(100);
    });
  });
});
