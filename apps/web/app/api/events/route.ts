import { NextResponse } from 'next/server';
import { createSSEStream, eventBus } from '@harbor/realtime';
import { fileWatcher } from '@harbor/jobs';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Track whether we've already kicked off the file watcher in this process. */
let watcherStarted = false;

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Auto-start file watchers on first SSE connection.
  // This is the most reliable startup hook: the SSE connection opens
  // as soon as the UI loads, so watchers begin immediately.
  if (!watcherStarted) {
    watcherStarted = true;
    fileWatcher.start().catch((err) => {
      console.error('[SSE] Failed to auto-start file watcher:', err);
      watcherStarted = false;
    });
  }

  // The SSE stream lives as long as the client keeps the connection
  // open. We deliberately do NOT impose a server-side timeout: the
  // 25s keepalive comments emitted by `createSSEStream` are enough
  // to keep the socket healthy, and any disconnect (tab close,
  // network blip, EventSource auto-reconnect) will run the `cancel`
  // hook below to release the listener.
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

  // Best-effort cleanup if the request itself is aborted server-side.
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
      // Disable Nginx-style buffering when proxied
      'X-Accel-Buffering': 'no',
    },
  });
}
