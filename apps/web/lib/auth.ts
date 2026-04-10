import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { AuthService, PermissionService, type AuthContext } from '@harbor/auth';
import { getSetting } from '@/lib/settings';

// Session secret must stay in env — it's a true secret.
const SESSION_SECRET = process.env.HARBOR_SESSION_SECRET ?? 'change-me-in-production';

// Auth services keyed by mode. Created on demand.
const authServices = {
  local: new AuthService(SESSION_SECRET, 'local'),
  multi: new AuthService(SESSION_SECRET, 'multi'),
};

const permissionService = new PermissionService();

export { permissionService };
export type { AuthContext };

/**
 * Get the current AuthService based on the database setting for auth.mode.
 * Falls back to env HARBOR_AUTH_MODE, then to 'local'.
 */
async function getAuthService(): Promise<AuthService> {
  const mode = await getSetting('auth.mode');
  return mode === 'multi' ? authServices.multi : authServices.local;
}

/**
 * Get the current auth context from the request.
 * Auth mode is read from database settings, not env.
 */
export async function getAuth(request?: Request): Promise<AuthContext | null> {
  let token: string | undefined;
  if (request) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    const cookieStore = await cookies();
    token = cookieStore.get('harbor-session')?.value;
  }

  const service = await getAuthService();
  return service.getAuthContext(token);
}

/**
 * Require auth — returns 401 if not authenticated.
 */
export async function requireAuth(request?: Request): Promise<AuthContext | NextResponse> {
  const ctx = await getAuth(request);
  if (!ctx) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }
  return ctx;
}

/**
 * Require a specific permission — returns 403 if not authorized.
 */
export function requirePermission(ctx: AuthContext, resource: string, action: string): NextResponse | null {
  if (!permissionService.hasPermission(ctx, resource, action)) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: `Missing permission: ${resource}:${action}` },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Check if user can access an archive root (non-private, or has role access).
 */
export function canAccessRoot(ctx: AuthContext, root: { isPrivate: boolean; accesses?: Array<{ roleId: string }> }): boolean {
  if (!root.isPrivate) return true;
  if (permissionService.isAdmin(ctx)) return true;
  const userRoleIds = new Set(ctx.roles.map((r) => r.id));
  return root.accesses?.some((a) => userRoleIds.has(a.roleId)) ?? false;
}

/** Re-export for auth API routes that need direct access. */
export async function getAuthServiceForRoute(): Promise<AuthService> {
  return getAuthService();
}
