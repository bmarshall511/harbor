'use client';

import { useState, useEffect } from 'react';

/** Returns true only after client hydration is complete. Safe for SSR-sensitive rendering. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Returns true if running inside Electron (harbor preload bridge available). */
export function useIsElectron(): boolean {
  const mounted = useMounted();
  if (!mounted) return false;
  return !!(window as any).harbor?.selectDirectory;
}
