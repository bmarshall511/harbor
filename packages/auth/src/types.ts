export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  isLocalUser: boolean;
  roles: Array<{
    id: string;
    name: string;
    systemRole: string;
    permissions: Array<{ resource: string; action: string }>;
  }>;
}

export interface SessionData {
  userId: string;
  token: string;
  expiresAt: Date;
}
