import type { StorageProvider } from '@harbor/types';

export class ProviderRegistry {
  private providers = new Map<string, StorageProvider>();

  register(provider: StorageProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider with id "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): StorageProvider | undefined {
    return this.providers.get(id);
  }

  getOrThrow(id: string): StorageProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider "${id}" not found`);
    }
    return provider;
  }

  getAll(): StorageProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }
}
