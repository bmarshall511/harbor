import type { AuthContext } from './types';
import type { ArchiveCapability } from '@harbor/types';

export class PermissionService {
  hasPermission(ctx: AuthContext, resource: string, action: string): boolean {
    // Owner always has all permissions (immutable)
    if (this.isOwner(ctx)) return true;
    return ctx.roles.some((role) =>
      role.permissions.some((p) => p.resource === resource && p.action === action),
    );
  }

  hasAnyPermission(ctx: AuthContext, resource: string, actions: string[]): boolean {
    return actions.some((action) => this.hasPermission(ctx, resource, action));
  }

  isAdmin(ctx: AuthContext): boolean {
    return ctx.roles.some((r) => r.systemRole === 'OWNER' || r.systemRole === 'ADMIN');
  }

  isOwner(ctx: AuthContext): boolean {
    return ctx.roles.some((r) => r.systemRole === 'OWNER');
  }

  canPerformFileOperation(
    ctx: AuthContext,
    capability: ArchiveCapability,
    rootCapabilities: ArchiveCapability[],
  ): boolean {
    // Check archive root supports the capability
    if (!rootCapabilities.includes(capability)) return false;

    // Map capability to permission
    const permissionMap: Record<ArchiveCapability, { resource: string; action: string }> = {
      READ: { resource: 'files', action: 'read' },
      WRITE: { resource: 'files', action: 'write' },
      DELETE: { resource: 'files', action: 'delete' },
      MOVE: { resource: 'files', action: 'write' },
      RENAME: { resource: 'files', action: 'write' },
      CREATE_FOLDERS: { resource: 'files', action: 'write' },
      SEARCH: { resource: 'files', action: 'read' },
    };

    const perm = permissionMap[capability];
    return this.hasPermission(ctx, perm.resource, perm.action);
  }

  filterAccessibleRootIds(ctx: AuthContext, rootIds: string[], rootAccesses: Array<{ archiveRootId: string; roleId: string }>): string[] {
    const userRoleIds = new Set(ctx.roles.map((r) => r.id));
    const accessibleRootIds = new Set(
      rootAccesses
        .filter((a) => userRoleIds.has(a.roleId))
        .map((a) => a.archiveRootId),
    );
    return rootIds.filter((id) => accessibleRootIds.has(id));
  }
}
