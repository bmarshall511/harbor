import { eventBus } from '@harbor/realtime';
import type { HarborEventType } from '@harbor/types';

export function emit(type: HarborEventType, payload: unknown, meta?: { archiveRootId?: string; userId?: string }) {
  eventBus.emit(type, payload, meta);
}
