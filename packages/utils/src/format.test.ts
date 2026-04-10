import { describe, it, expect } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('formats zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(5242880)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });

  it('respects decimal parameter', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});
