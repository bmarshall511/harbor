import type { HarborEvent } from '@harbor/types';

/**
 * Build a Server-Sent Events stream with keepalive comments so the
 * connection survives long idle periods. Browsers, proxies, and dev
 * tools will quietly close an SSE socket that goes silent for too
 * long, after which the watcher's emitted events go nowhere even
 * though the watcher itself is still running. A `:ping` comment line
 * every 25 seconds keeps every layer happy.
 *
 * Returns:
 *   • `readable`  — the ReadableStream to hand to `Response`
 *   • `send`      — push a typed `HarborEvent` to the client
 *   • `close`     — tear down the stream and cancel the keepalive
 */
export function createSSEStream(onCancel?: () => void): {
  readable: ReadableStream;
  send: (event: HarborEvent) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval> | null = null;

  function stopKeepalive() {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      // Send an initial comment immediately so the client knows the
      // stream is open. Comments (lines starting with `:`) are ignored
      // by the EventSource API but they keep the connection alive.
      try {
        controller.enqueue(encoder.encode(': connected\n\n'));
      } catch {
        /* already closed */
      }
      keepalive = setInterval(() => {
        if (!controller) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stopKeepalive();
        }
      }, 25_000);
    },
    cancel() {
      stopKeepalive();
      controller = null;
      onCancel?.();
    },
  });

  return {
    readable,
    send(event: HarborEvent) {
      if (!controller) return;
      try {
        const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      } catch {
        // Stream may be closed
      }
    },
    close() {
      stopKeepalive();
      try { controller?.close(); } catch { /* already closed */ }
      controller = null;
    },
  };
}
