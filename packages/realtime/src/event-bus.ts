import type { HarborEvent, HarborEventType } from '@harbor/types';
import { randomUUID } from 'node:crypto';

export type EventHandler = (event: HarborEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private globalHandlers = new Set<EventHandler>();

  emit<T = unknown>(type: HarborEventType, payload: T, meta?: { archiveRootId?: string; userId?: string }): void {
    const event: HarborEvent<T> = {
      id: randomUUID(),
      type,
      payload,
      archiveRootId: meta?.archiveRootId,
      userId: meta?.userId,
      timestamp: new Date().toISOString(),
    };

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try { handler(event); } catch { /* swallow handler errors */ }
      }
    }

    // Notify global handlers
    for (const handler of this.globalHandlers) {
      try { handler(event); } catch { /* swallow handler errors */ }
    }
  }

  on(type: HarborEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAll(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  off(type: HarborEventType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  removeAll(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}

// Singleton for the application
export const eventBus = new EventBus();
