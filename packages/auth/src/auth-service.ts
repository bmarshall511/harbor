import { UserRepository } from '@harbor/database';
import { hashPassword, verifyPassword } from './password';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthContext, SessionData } from './types';

export class AuthService {
  private userRepo = new UserRepository();
  private secret: Uint8Array;
  private authMode: 'local' | 'multi';

  // Per-process caches to keep `getAuthContext` from re-running a
  // full nested Prisma query (~4 SQL statements) on every API
  // request. The cached entries are short-lived (60s) so token
  // revocations / role changes are picked up quickly.
  private static readonly CACHE_TTL_MS = 60_000;
  private localUserCache: { ctx: AuthContext; at: number } | null = null;
  private contextCache = new Map<string, { ctx: AuthContext; at: number }>();

  constructor(sessionSecret: string, authMode: 'local' | 'multi' = 'local') {
    this.secret = new TextEncoder().encode(sessionSecret);
    this.authMode = authMode;
  }

  /** Drop all cached contexts (e.g. after a logout or role change). */
  invalidateAuthCache(): void {
    this.localUserCache = null;
    this.contextCache.clear();
  }

  async getAuthContext(token?: string): Promise<AuthContext | null> {
    const now = Date.now();

    // Local mode: always return the local user. Cache it across
    // requests so the dashboard's parallel API calls don't each
    // re-query the user + roles + role permissions.
    if (this.authMode === 'local') {
      if (this.localUserCache && now - this.localUserCache.at < AuthService.CACHE_TTL_MS) {
        return this.localUserCache.ctx;
      }
      const localUser = await this.userRepo.ensureLocalUser();
      const ctx = this.userToContext(localUser);
      this.localUserCache = { ctx, at: now };
      return ctx;
    }

    // Multi-user mode: validate token
    if (!token) return null;

    // Token-keyed cache. The JWT itself is the cache key, and we
    // verify it on every cached read so an expired token is never
    // returned.
    const cached = this.contextCache.get(token);
    if (cached && now - cached.at < AuthService.CACHE_TTL_MS) {
      return cached.ctx;
    }

    try {
      const { payload } = await jwtVerify(token, this.secret);
      const userId = payload.sub;
      if (!userId) return null;

      const user = await this.userRepo.findById(userId);
      if (!user || !user.isActive) return null;

      // In multi-user mode, reject auto-created local user sessions.
      // Users must log in with real credentials.
      if (user.isLocalUser) return null;

      const ctx = this.userToContext(user);
      this.contextCache.set(token, { ctx, at: now });
      return ctx;
    } catch {
      return null;
    }
  }

  async login(username: string, password: string): Promise<SessionData | null> {
    const user = await this.userRepo.findByUsername(username);
    if (!user || !user.passwordHash || !user.isActive) return null;

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    return this.createSession(user.id);
  }

  async register(data: {
    username: string;
    email?: string;
    displayName: string;
    password: string;
  }): Promise<SessionData> {
    const passwordHash = await hashPassword(data.password);
    const user = await this.userRepo.create({
      username: data.username,
      email: data.email,
      displayName: data.displayName,
      passwordHash,
    });
    return this.createSession(user.id);
  }

  async logout(token: string): Promise<void> {
    try {
      await this.userRepo.deleteSession(token);
    } catch {
      // Session may already be gone
    }
    // Drop the cached context for this token so subsequent requests
    // don't accidentally re-authorize a logged-out session.
    this.contextCache.delete(token);
  }

  async createSession(userId: string): Promise<SessionData> {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const token = await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.secret);

    await this.userRepo.createSession(userId, token, expiresAt);
    return { userId, token, expiresAt };
  }

  private userToContext(user: any): AuthContext {
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      isLocalUser: user.isLocalUser,
      roles: user.roleAssignments.map((ra: any) => ({
        id: ra.role.id,
        name: ra.role.name,
        systemRole: ra.role.systemRole,
        permissions: ra.role.permissions.map((p: any) => ({
          resource: p.resource,
          action: p.action,
        })),
      })),
    };
  }
}
