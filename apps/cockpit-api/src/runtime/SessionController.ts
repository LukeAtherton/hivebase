// One controller per session. Owns the SDK iterator, the local resolver map
// (decisionId → callback), and state transitions for this session only.
//
// Cross-session communication only via eventBus. No module-level globals.
// Mirrors the GenServer/actor pattern: state + mailbox, supervised independently.
//
// Lifecycle:
//   spawn(spec)      → creates controller, starts SDK loop in background
//   awaitDecision()  → register a held-promise resolver (canUseTool / Notification)
//   resolve(...)     → fire one of those resolvers
//   stop()           → abort SDK + reject any open resolvers
//   ended()          → did the SDK loop already exit?

import { generateCockpitEventId } from '@kybernos/ids';
import type { AgentMessage, NormalisedEvent, NormalisedEventType } from '@kybernos/core';
import { eventBus } from '../lib/event-bus.js';

export type ResolverChoice =
  | { kind: 'approved' }
  | { kind: 'blocked'; message?: string; interrupt?: boolean }
  | { kind: 'replied'; reply: string };

type ResolverFn = (choice: ResolverChoice) => void;

export interface SessionRefs {
  cockpitSessionId: string;
  cockpitAgentId: string;
  cockpitProjectId: string;
}

export class SessionController {
  readonly refs: SessionRefs;
  private readonly resolvers = new Map<string, ResolverFn>();
  private readonly abortController = new AbortController();
  private endedFlag = false;

  constructor(refs: SessionRefs) {
    this.refs = refs;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  ended(): boolean {
    return this.endedFlag;
  }

  // Publish a normalised event with this session's refs filled in.
  publish(type: NormalisedEventType, payload: Record<string, unknown>): NormalisedEvent {
    const event: NormalisedEvent = {
      cockpitEventId: generateCockpitEventId(),
      cockpitSessionId: this.refs.cockpitSessionId,
      cockpitAgentId: this.refs.cockpitAgentId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    eventBus.publish(event);
    return event;
  }

  // Register a held-promise resolver tied to a decisionId. Caller must await
  // the returned promise. The persistence layer / cooldown scheduler / route
  // handler resolves it via this.resolve(decisionId, choice).
  awaitDecision(decisionId: string): Promise<ResolverChoice> {
    return new Promise<ResolverChoice>((resolve) => {
      this.resolvers.set(decisionId, resolve);
    });
  }

  // Returns true if a resolver was actually fired.
  resolve(decisionId: string, choice: ResolverChoice): boolean {
    const r = this.resolvers.get(decisionId);
    if (!r) return false;
    this.resolvers.delete(decisionId);
    r(choice);
    return true;
  }

  hasOpenResolvers(): boolean {
    return this.resolvers.size > 0;
  }

  // Adapter calls this when the SDK loop exits (clean or error).
  markEnded(): void {
    this.endedFlag = true;
    // Anything still waiting gets a hard block — the agent won't come back.
    for (const [, r] of this.resolvers) {
      try {
        r({ kind: 'blocked', message: 'session ended', interrupt: true });
      } catch {
        /* ignore */
      }
    }
    this.resolvers.clear();
  }

  // External stop (UI / shutdown). Aborts the SDK iterator + clears resolvers.
  stop(reason: string): void {
    this.abortController.abort(new Error(reason));
    this.markEnded();
  }

  // Optional: feed a follow-up user message back into the SDK session.
  // Implementation lives on the adapter — controllers don't own the iterator's
  // input side. Adapter sets this on construction.
  sendUserMessage: (message: AgentMessage) => Promise<void> = async () => {
    // default no-op until the adapter wires its own implementation
  };
}

// Process-wide registry of live controllers, keyed by session id. Routes look
// up the controller to call resolve() / stop() / sendUserMessage().
const liveControllers = new Map<string, SessionController>();

export function registerController(c: SessionController): void {
  liveControllers.set(c.refs.cockpitSessionId, c);
}

export function getController(sessionId: string): SessionController | undefined {
  return liveControllers.get(sessionId);
}

export function dropController(sessionId: string): void {
  liveControllers.delete(sessionId);
}

export function allControllers(): SessionController[] {
  return Array.from(liveControllers.values());
}
