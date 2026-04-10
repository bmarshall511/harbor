import { describe, it, expect, vi } from 'vitest';
import { sleep, retry } from './async';

describe('sleep', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe('retry', () => {
  it('succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await retry(fn, { attempts: 3, delayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(retry(fn, { attempts: 2, delayMs: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
