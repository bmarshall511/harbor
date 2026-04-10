import { describe, it, expect, vi } from 'vitest';
import { PermissionService } from './permission-service';
import type { AuthContext } from './types';

/**
 * Tests for auth enforcement patterns used across API routes.
 * Validates that the permission checks that guard mutations
 * work correctly for all role types.
 */

const svc = new PermissionService();

function ctx(systemRole: string, permissions: Array<{ resource: string; action: string }>): AuthContext {
  return {
    userId: 'user-1',
    username: 'test',
    displayName: 'Test',
    isLocalUser: false,
    roles: [{ id: 'role-1', name: systemRole, systemRole, permissions }],
  };
}

const OWNER = ctx('OWNER', [
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
]);

const EDITOR = ctx('EDITOR', [
  { resource: 'files', action: 'read' },
  { resource: 'files', action: 'write' },
  { resource: 'metadata', action: 'read' },
  { resource: 'metadata', action: 'write' },
  { resource: 'tags', action: 'read' },
  { resource: 'tags', action: 'write' },
  { resource: 'relations', action: 'read' },
  { resource: 'relations', action: 'write' },
]);

const VIEWER = ctx('VIEWER', [
  { resource: 'files', action: 'read' },
  { resource: 'metadata', action: 'read' },
  { resource: 'tags', action: 'read' },
  { resource: 'relations', action: 'read' },
]);

describe('Route auth enforcement patterns', () => {
  describe('archive root management', () => {
    it('owner can manage archive roots', () => {
      expect(svc.hasPermission(OWNER, 'archive_roots', 'manage')).toBe(true);
    });
    it('editor cannot manage archive roots', () => {
      expect(svc.hasPermission(EDITOR, 'archive_roots', 'manage')).toBe(false);
    });
    it('viewer cannot manage archive roots', () => {
      expect(svc.hasPermission(VIEWER, 'archive_roots', 'manage')).toBe(false);
    });
  });

  describe('file mutations', () => {
    it('owner can delete files', () => {
      expect(svc.hasPermission(OWNER, 'files', 'delete')).toBe(true);
    });
    it('editor can write files but not delete', () => {
      expect(svc.hasPermission(EDITOR, 'files', 'write')).toBe(true);
      expect(svc.hasPermission(EDITOR, 'files', 'delete')).toBe(false);
    });
    it('viewer cannot write or delete files', () => {
      expect(svc.hasPermission(VIEWER, 'files', 'write')).toBe(false);
      expect(svc.hasPermission(VIEWER, 'files', 'delete')).toBe(false);
    });
  });

  describe('metadata mutations', () => {
    it('owner can write metadata', () => {
      expect(svc.hasPermission(OWNER, 'metadata', 'write')).toBe(true);
    });
    it('editor can write metadata', () => {
      expect(svc.hasPermission(EDITOR, 'metadata', 'write')).toBe(true);
    });
    it('viewer cannot write metadata', () => {
      expect(svc.hasPermission(VIEWER, 'metadata', 'write')).toBe(false);
    });
  });

  describe('tag mutations', () => {
    it('owner can write and delete tags', () => {
      expect(svc.hasPermission(OWNER, 'tags', 'write')).toBe(true);
      expect(svc.hasPermission(OWNER, 'tags', 'delete')).toBe(true);
    });
    it('editor can write tags but not delete', () => {
      expect(svc.hasPermission(EDITOR, 'tags', 'write')).toBe(true);
      expect(svc.hasPermission(EDITOR, 'tags', 'delete')).toBe(false);
    });
    it('viewer cannot write tags', () => {
      expect(svc.hasPermission(VIEWER, 'tags', 'write')).toBe(false);
    });
  });

  describe('relation mutations', () => {
    it('owner can create and delete relations', () => {
      expect(svc.hasPermission(OWNER, 'relations', 'write')).toBe(true);
      expect(svc.hasPermission(OWNER, 'relations', 'delete')).toBe(true);
    });
    it('editor can create relations but not delete', () => {
      expect(svc.hasPermission(EDITOR, 'relations', 'write')).toBe(true);
      expect(svc.hasPermission(EDITOR, 'relations', 'delete')).toBe(false);
    });
    it('viewer cannot create relations', () => {
      expect(svc.hasPermission(VIEWER, 'relations', 'write')).toBe(false);
    });
  });

  describe('admin operations', () => {
    it('owner can access admin', () => {
      expect(svc.hasPermission(OWNER, 'admin', 'manage')).toBe(true);
    });
    it('editor cannot access admin', () => {
      expect(svc.hasPermission(EDITOR, 'admin', 'manage')).toBe(false);
    });
  });

  describe('file operations with capabilities', () => {
    const fullCaps = ['READ', 'WRITE', 'DELETE', 'MOVE', 'RENAME', 'CREATE_FOLDERS', 'SEARCH'] as const;
    const readOnlyCaps = ['READ', 'SEARCH'] as const;

    it('editor can write on full-capability root', () => {
      expect(svc.canPerformFileOperation(EDITOR, 'WRITE', [...fullCaps])).toBe(true);
    });
    it('editor cannot write on read-only root', () => {
      expect(svc.canPerformFileOperation(EDITOR, 'WRITE', [...readOnlyCaps])).toBe(false);
    });
    it('owner can delete on full-capability root', () => {
      expect(svc.canPerformFileOperation(OWNER, 'DELETE', [...fullCaps])).toBe(true);
    });
    it('editor cannot delete even on full-capability root', () => {
      expect(svc.canPerformFileOperation(EDITOR, 'DELETE', [...fullCaps])).toBe(false);
    });
    it('viewer can read on any root', () => {
      expect(svc.canPerformFileOperation(VIEWER, 'READ', [...readOnlyCaps])).toBe(true);
    });
  });
});
