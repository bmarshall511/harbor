/**
 * Resilient API fetch for Harbor.
 *
 * Handles Next.js dev-mode cold compilation: when an API route is hit for the
 * first time, Next.js may return 404 or HTML while compiling. This helper
 * retries once on non-JSON responses to handle this gracefully.
 */
export async function fetchApi<T>(
  path: string,
  options?: RequestInit & { retries?: number },
): Promise<T> {
  const { retries = 1, ...fetchOptions } = options ?? {};
  const url = `/api${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
      ...fetchOptions,
    });

    // Check if response is JSON
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      // Non-JSON response — likely cold-compile 404. Retry after a short wait.
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error('Server is starting up. Please try again in a moment.');
    }

    const body = await res.json();

    if (!res.ok) {
      throw new Error(body.message || `Request failed (${res.status})`);
    }

    return body as T;
  }

  throw new Error('Request failed after retries');
}
