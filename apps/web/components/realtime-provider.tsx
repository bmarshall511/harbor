'use client';

import { createContext, useContext } from 'react';
import { useRealtime, type RealtimeStatus } from '@/lib/use-realtime';
import type { ReactNode } from 'react';
import { WifiOff } from 'lucide-react';

const RealtimeContext = createContext<RealtimeStatus>('connecting');

export function useRealtimeStatus() {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const status = useRealtime();

  return (
    <RealtimeContext.Provider value={status}>
      {children}
      {status === 'reconnecting' && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 shadow-lg backdrop-blur dark:text-amber-400">
          <WifiOff className="h-3.5 w-3.5" />
          Reconnecting to server...
        </div>
      )}
    </RealtimeContext.Provider>
  );
}
