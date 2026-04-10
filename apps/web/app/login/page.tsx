'use client';

import { Suspense, useState, useEffect } from 'react';
import { useAuth } from '@/lib/use-auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { login, loginError, loginPending, register, registerError, registerPending, authenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [mode, setMode] = useState<'login' | 'register' | 'setup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);

  // Check if database is initialized
  const [dbInitialized, setDbInitialized] = useState<boolean | null>(null);
  const [dbInitializing, setDbInitializing] = useState(false);
  const [dbInitSteps, setDbInitSteps] = useState<Array<{ step: string; status: string; message?: string }>>([]);
  const [dbInitError, setDbInitError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/setup/database')
      .then((res) => res.json())
      .then((data) => setDbInitialized(data.initialized))
      .catch(() => setDbInitialized(false));
  }, []);

  const handleInitializeDb = async () => {
    setDbInitializing(true);
    setDbInitError(null);
    setDbInitSteps([]);
    try {
      const res = await fetch('/api/setup/database', { method: 'POST' });
      const data = await res.json();
      setDbInitSteps(data.steps ?? []);
      if (res.ok) {
        setDbInitialized(true);
      } else {
        setDbInitError(data.message ?? 'Initialization failed');
      }
    } catch (err) {
      setDbInitError(err instanceof Error ? err.message : 'Initialization failed');
    } finally {
      setDbInitializing(false);
    }
  };

  // Check auth mode (only after DB is initialized)
  const { data: authMode } = useQuery({
    queryKey: ['auth-mode'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings = await res.json();
          return (settings['auth.mode'] ?? 'local') as string;
        }
      } catch { /* fall through */ }
      return 'multi';
    },
    staleTime: 60 * 1000,
    enabled: dbInitialized === true,
  });

  // Check if first-admin setup is needed
  const { data: setupStatus } = useQuery({
    queryKey: ['auth-setup'],
    queryFn: async () => {
      const res = await fetch('/api/auth/setup');
      if (!res.ok) return { needsSetup: false };
      return res.json() as Promise<{ needsSetup: boolean }>;
    },
    enabled: authMode === 'multi',
  });

  // Check if registration is enabled
  const { data: registrationEnabled } = useQuery({
    queryKey: ['registration-enabled'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings = await res.json();
          return settings['registration.enabled'] === 'true';
        }
      } catch { /* settings unavailable */ }
      return true; // Default to enabled
    },
    enabled: authMode === 'multi',
  });

  const authModeResolved = authMode !== undefined;
  const isLocalMode = authMode === 'local';
  const isMultiMode = authMode === 'multi';
  const needsSetup = setupStatus?.needsSetup === true;
  const canRegister = isMultiMode && !needsSetup && registrationEnabled === true;

  // Auto-show setup mode when needed
  useEffect(() => {
    if (needsSetup) setMode('setup');
  }, [needsSetup]);

  // If already authenticated, redirect
  useEffect(() => {
    if (!authLoading && authenticated) {
      router.replace(redirect);
    }
  }, [authLoading, authenticated, router, redirect]);

  // Local mode auto-login
  useEffect(() => {
    if (authModeResolved && isLocalMode && !authLoading && !authenticated) {
      fetch('/api/auth/me').then(() => {
        window.location.href = redirect;
      });
    }
  }, [authModeResolved, isLocalMode, authLoading, authenticated, redirect]);

  // ── Database initialization wizard ────────────────────────────
  if (dbInitialized === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <div className="text-center">
            <Archive className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome to Harbor</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your database needs to be set up before you can use Harbor.
              This will create all tables, indexes, and default configuration.
            </p>
          </div>

          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
            {dbInitSteps.length > 0 && (
              <div className="mb-4 space-y-2">
                {dbInitSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {step.status === 'ok' ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 text-green-600 text-xs">✓</span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-600 text-xs">✗</span>
                    )}
                    <span className={step.status === 'ok' ? 'text-foreground' : 'text-destructive'}>{step.step}</span>
                    {step.message && <span className="text-[10px] text-muted-foreground">({step.message})</span>}
                  </div>
                ))}
              </div>
            )}

            {dbInitError && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {dbInitError}
              </div>
            )}

            <button
              onClick={handleInitializeDb}
              disabled={dbInitializing}
              className={cn(
                'w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              {dbInitializing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Initializing database...
                </span>
              ) : dbInitSteps.length > 0 && dbInitError ? (
                'Retry'
              ) : (
                'Initialize Database'
              )}
            </button>

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Make sure your <code className="rounded bg-muted px-1">DATABASE_URL</code> is set correctly in <code className="rounded bg-muted px-1">.env</code> and the PostgreSQL server is running.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (dbInitialized === null || !authModeResolved || authLoading || (isLocalMode && !authenticated)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            {dbInitialized === null ? 'Checking database...' : isLocalMode ? 'Starting Harbor...' : 'Checking session...'}
          </p>
        </div>
      </div>
    );
  }

  if (authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupPending(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: displayName || username, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      queryClient.invalidateQueries({ queryKey: ['auth-setup'] });
      router.push(redirect);
    } catch (err: any) {
      setSetupError(err.message ?? 'Setup failed');
    }
    setSetupPending(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await login({ username, password });
    } else if (mode === 'register') {
      await register({ username, displayName: displayName || username, email: email || undefined, password });
    }
  };

  const error = mode === 'setup' ? setupError : mode === 'login' ? loginError : registerError;
  const pending = mode === 'setup' ? setupPending : mode === 'login' ? loginPending : registerPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {mode === 'setup' ? (
              <ShieldCheck className="h-6 w-6 text-primary" />
            ) : (
              <Archive className="h-6 w-6 text-primary" />
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === 'setup' ? 'Set Up Harbor' : 'Harbor'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'setup'
              ? 'Create your admin account to get started'
              : mode === 'login'
                ? 'Sign in to your account'
                : 'Create your account'}
          </p>
        </div>

        <form onSubmit={mode === 'setup' ? handleSetup : handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium">Username</label>
            <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required autoFocus autoComplete="username" />
          </div>

          {(mode === 'register' || mode === 'setup') && (
            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium">Display Name</label>
              <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder={username || 'Your name'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email <span className="text-muted-foreground">(optional)</span>
              </label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          )}

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
            <div className="relative">
              <input id="password" type={showPassword ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {mode === 'setup' && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              This will be the admin account with full access to Harbor.
            </div>
          )}

          <button type="submit" disabled={pending}
            className={cn(
              'w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}>
            {pending
              ? (mode === 'setup' ? 'Creating admin...' : mode === 'login' ? 'Signing in...' : 'Creating account...')
              : (mode === 'setup' ? 'Create Admin Account' : mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        {/* Mode toggles — only in multi-user mode, not during setup */}
        {canRegister && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <p>Need an account?{' '}
                <button onClick={() => setMode('register')} className="font-medium text-primary hover:underline">Register</button>
              </p>
            ) : mode === 'register' ? (
              <p>Already have an account?{' '}
                <button onClick={() => setMode('login')} className="font-medium text-primary hover:underline">Sign in</button>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
