import { EventEmitter } from 'node:events';
import type { NormalisedEvent } from '@kybernos/core';

// Process-local pub/sub. Phase 1 ships single-process; Phase 2+ swap for Redis.
class EventBus extends EventEmitter {
  publish(event: NormalisedEvent) {
    this.emit('event', event);
    this.emit(`session:${event.cockpitSessionId}`, event);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(0); // many sessions × WS clients
