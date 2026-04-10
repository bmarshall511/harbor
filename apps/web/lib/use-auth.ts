'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isLocalUser: boolean;
  roles: Array<{ name: string; systemRole: string }>;
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
      // Full page navigation ensures the cookie is sent with the next request
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
      // Client-side permission check (rough — server enforces the real check)
      if (!data?.user) return false;
      const systemRoles = data.user.roles.map((r) => r.systemRole);
      if (systemRoles.includes('OWNER') || systemRoles.includes('ADMIN')) return true;
      if (action === 'read' && systemRoles.includes('VIEWER')) return true;
      if (['read', 'write'].includes(action) && systemRoles.includes('EDITOR')) return true;
      return false;
    },
  };
}
