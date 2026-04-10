import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from './registry';
import type { StorageProvider, StorageProviderCapabilities } from '@harbor/types';

function mockProvider(id: string): StorageProvider {
  return {
    id,
    name: `Provider ${id}`,
    type: 'test',
    getCapabilities: () => ({
      canRead: true, canWrite: false, canDelete: false, canMove: false,
      canRename: false, canCreateFolders: false, canGeneratePreviews: false,
      canSearch: false, canWatch: false,
    }),
    listDirectory: async function* () {},
    exists: async () => false,
    readFile: async () => Buffer.from(''),
    readFileStream: async () => { throw new Error('not implemented'); },
    getMetadata: async () => ({ size: 0, mimeType: null, createdAt: null, modifiedAt: null, hash: null }),
    writeFile: async () => {},
    createFolder: async () => {},
    deleteFile: async () => {},
    deleteFolder: async () => {},
    moveFile: async () => {},
    renameFile: async () => {},
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry();
    const provider = mockProvider('test-1');
    registry.register(provider);

    expect(registry.get('test-1')).toBe(provider);
    expect(registry.has('test-1')).toBe(true);
  });

  it('returns undefined for unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('getOrThrow throws for unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.getOrThrow('nonexistent')).toThrow('Provider "nonexistent" not found');
  });

  it('prevents duplicate registration', () => {
    const registry = new ProviderRegistry();
    registry.register(mockProvider('dup'));
    expect(() => registry.register(mockProvider('dup'))).toThrow('already registered');
  });

  it('unregisters a provider', () => {
    const registry = new ProviderRegistry();
    registry.register(mockProvider('remove-me'));
    expect(registry.has('remove-me')).toBe(true);

    registry.unregister('remove-me');
    expect(registry.has('remove-me')).toBe(false);
  });

  it('getAll returns all registered providers', () => {
    const registry = new ProviderRegistry();
    registry.register(mockProvider('a'));
    registry.register(mockProvider('b'));
    registry.register(mockProvider('c'));

    expect(registry.getAll()).toHaveLength(3);
  });
});
