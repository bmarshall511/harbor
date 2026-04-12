'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

interface AuthPermission {
  resource: string;
  action: string;
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isLocalUser: boolean;
  isOwner: boolean;
  roles: Array<{ name: string; systemRole: string }>;
  permissions: AuthPermission[];
}

interface AuthState {
  authenticated: boolean;
  user?: AuthUser;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery<AuthState>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return { authenticated: false };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Login failed');
      }
      return res.json();
    },
    onSuccess: () => {
      window.location.href = '/';
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      router.push('/login');
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { username: string; email?: string; displayName: string; password: string }) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Registration failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      router.push('/');
    },
  });

  return {
    user: data?.user ?? null,
    authenticated: data?.authenticated ?? false,
    isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error?.message ?? null,
    loginPending: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    registerError: registerMutation.error?.message ?? null,
    registerPending: registerMutation.isPending,
    hasPermission: (resource: string, action: string) => {
      if (!data?.user) return false;
      // Owner always has all permissions
      if (data.user.isOwner) return true;
      // Also check systemRole as fallback for Owner (handles stale cached responses)
      if (data.user.roles?.some((r) => r.systemRole === 'OWNER')) return true;
      return (data.user.permissions ?? []).some((p) => p.resource === resource && p.action === action);
    },
  };
}
