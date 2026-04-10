export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; backoff?: boolean } = {},
): Promise<T> {
  const { attempts = 3, delayMs = 1000, backoff = true } = options;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await sleep(backoff ? delayMs * Math.pow(2, i) : delayMs);
      }
    }
  }

  throw lastError;
}
