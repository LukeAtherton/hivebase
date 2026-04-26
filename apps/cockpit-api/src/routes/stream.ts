import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { eventBus } from '../lib/event-bus.js';
import type { NormalisedEvent } from '@swarm/core';

// Single firehose: every event + decision lifecycle for the UI to consume.
// Phase 1 is single-process so we can wire WS clients directly to the in-proc
// EventEmitter; Redis fan-out comes when we run multiple cockpit-api replicas.
export async function registerStreamRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket) => {
    const onEvent = (event: NormalisedEvent) => {
      try {
        socket.send(JSON.stringify({ kind: 'event', event }));
      } catch {
        /* socket closed */
      }
    };
    const onDecisionCreated = (msg: unknown) => {
      try {
        socket.send(JSON.stringify({ kind: 'decision-created', ...((msg as object) ?? {}) }));
      } catch {
        /* socket closed */
      }
    };
    const onDecisionResolved = (msg: unknown) => {
      try {
        socket.send(JSON.stringify({ kind: 'decision-resolved', ...((msg as object) ?? {}) }));
      } catch {
        /* socket closed */
      }
    };

    eventBus.on('event', onEvent);
    eventBus.on('decision-created', onDecisionCreated);
    eventBus.on('decision-resolved', onDecisionResolved);

    socket.on('close', () => {
      eventBus.off('event', onEvent);
      eventBus.off('decision-created', onDecisionCreated);
      eventBus.off('decision-resolved', onDecisionResolved);
    });
  });
}
