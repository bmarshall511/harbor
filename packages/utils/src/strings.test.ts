import { describe, it, expect } from 'vitest';
import { slugify, truncate } from './strings';

describe('slugify', () => {
  it('converts to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World! #2024')).toBe('hello-world-2024');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });
});

describe('truncate', () => {
  it('returns string unchanged if under limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('supports custom suffix', () => {
    expect(truncate('hello world', 8, '…')).toBe('hello w…');
  });

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});
