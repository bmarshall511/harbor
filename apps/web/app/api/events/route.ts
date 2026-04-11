import { NextResponse } from 'next/server';
import { createSSEStream, eventBus } from '@harbor/realtime';
import { requireAuth } from '@/lib/auth';
import { isLocalMode } from '@/lib/deployment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Track whether we've already kicked off the file watcher in this process. */
let watcherStarted = false;

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Auto-start file watchers on first SSE connection — LOCAL MODE ONLY.
  // On Vercel (cloud mode), there's no persistent filesystem to watch
  // and each serverless invocation is isolated, so starting watchers
  // would just waste resources and cause duplicate event noise.
  if (isLocalMode && !watcherStarted) {
    watcherStarted = true;
    import('@harbor/jobs').then(({ fileWatcher }) => {
      fileWatcher.start().catch((err) => {
        console.error('[SSE] Failed to auto-start file watcher:', err);
        watcherStarted = false;
      });
    });
  }

  let unsubscribe: (() => void) | null = null;

  const { readable, send, close } = createSSEStream(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  unsubscribe = eventBus.onAll((event) => {
    send(event);
  });

  request.signal.addEventListener('abort', () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    close();
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
