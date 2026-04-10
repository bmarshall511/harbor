import { describe, it, expect } from 'vitest';
import { PermissionService } from './permission-service';
import type { AuthContext } from './types';

function makeContext(overrides?: Partial<AuthContext>): AuthContext {
  return {
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    isLocalUser: false,
    roles: [
      {
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
    ],
    ...overrides,
  };
}

function makeOwnerContext(): AuthContext {
  return {
    userId: 'owner-1',
    username: 'owner',
    displayName: 'Owner',
    isLocalUser: true,
    roles: [
      {
        id: 'role-owner',
        name: 'Owner',
        systemRole: 'OWNER',
        permissions: [
          { resource: 'files', action: 'read' },
          { resource: 'files', action: 'write' },
          { resource: 'files', action: 'delete' },
          { resource: 'files', action: 'manage' },
          { resource: 'admin', action: 'manage' },
          { resource: 'archive_roots', action: 'manage' },
        ],
      },
    ],
  };
}

function makeViewerContext(): AuthContext {
  return {
    userId: 'viewer-1',
    username: 'viewer',
    displayName: 'Viewer',
    isLocalUser: false,
    roles: [
      {
        id: 'role-viewer',
        name: 'Viewer',
        systemRole: 'VIEWER',
        permissions: [
          { resource: 'files', action: 'read' },
          { resource: 'metadata', action: 'read' },
          { resource: 'tags', action: 'read' },
          { resource: 'relations', action: 'read' },
        ],
      },
    ],
  };
}

describe('PermissionService', () => {
  const svc = new PermissionService();

  describe('hasPermission', () => {
    it('returns true when user has the permission', () => {
      const ctx = makeContext();
      expect(svc.hasPermission(ctx, 'files', 'read')).toBe(true);
      expect(svc.hasPermission(ctx, 'files', 'write')).toBe(true);
      expect(svc.hasPermission(ctx, 'metadata', 'write')).toBe(true);
    });

    it('returns false when user lacks the permission', () => {
      const ctx = makeContext();
      expect(svc.hasPermission(ctx, 'files', 'delete')).toBe(false);
      expect(svc.hasPermission(ctx, 'admin', 'manage')).toBe(false);
      expect(svc.hasPermission(ctx, 'archive_roots', 'manage')).toBe(false);
    });

    it('viewer cannot write', () => {
      const ctx = makeViewerContext();
      expect(svc.hasPermission(ctx, 'files', 'read')).toBe(true);
      expect(svc.hasPermission(ctx, 'files', 'write')).toBe(false);
      expect(svc.hasPermission(ctx, 'metadata', 'write')).toBe(false);
    });

    it('owner has admin permissions', () => {
      const ctx = makeOwnerContext();
      expect(svc.hasPermission(ctx, 'admin', 'manage')).toBe(true);
      expect(svc.hasPermission(ctx, 'files', 'delete')).toBe(true);
    });
  });

  describe('isAdmin', () => {
    it('returns true for OWNER role', () => {
      expect(svc.isAdmin(makeOwnerContext())).toBe(true);
    });

    it('returns false for EDITOR role', () => {
      expect(svc.isAdmin(makeContext())).toBe(false);
    });

    it('returns false for VIEWER role', () => {
      expect(svc.isAdmin(makeViewerContext())).toBe(false);
    });
  });

  describe('canPerformFileOperation', () => {
    it('allows read when root has READ and user has files:read', () => {
      const ctx = makeContext();
      expect(svc.canPerformFileOperation(ctx, 'READ', ['READ', 'WRITE'])).toBe(true);
    });

    it('denies write when root only has READ', () => {
      const ctx = makeContext();
      expect(svc.canPerformFileOperation(ctx, 'WRITE', ['READ'])).toBe(false);
    });

    it('denies delete when user lacks files:delete even if root supports it', () => {
      const ctx = makeContext(); // Editor has no delete permission
      expect(svc.canPerformFileOperation(ctx, 'DELETE', ['READ', 'WRITE', 'DELETE'])).toBe(false);
    });

    it('allows delete for owner when root supports it', () => {
      const ctx = makeOwnerContext();
      expect(svc.canPerformFileOperation(ctx, 'DELETE', ['READ', 'WRITE', 'DELETE'])).toBe(true);
    });

    it('denies move when root lacks MOVE capability', () => {
      const ctx = makeOwnerContext();
      expect(svc.canPerformFileOperation(ctx, 'MOVE', ['READ', 'WRITE'])).toBe(false);
    });
  });
});
