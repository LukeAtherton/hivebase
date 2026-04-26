// Local adapter built on @anthropic-ai/claude-agent-sdk.
//
// Why this over the CLI: canUseTool is an async callback we own — the Promise
// we return resolves only when the human acts on the queue (or the cooldown
// expires). That IS the reply round-trip. Notification hook fires for
// volunteered scope-ambiguity. Stream messages drive the rest.
//
// One SDK query() per session, owned by a SessionController.

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  PermissionResult,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { generateCockpitDecisionId } from '@kybernos/ids';
import { eq } from 'drizzle-orm';
import { cockpitDecisions, cockpitSessions, getCockpitDb } from '@kybernos/platform';
import {
  classify,
  type AgentAdapter,
  type AgentMessage,
  type AgentSession,
  type Capability,
  type NormalisedEvent,
  type PlanItem,
  type SpawnSpec,
} from '@kybernos/core';
import { eventBus } from '../../lib/event-bus.js';
import { scheduleCooldown } from '../../lib/cooldown-scheduler.js';
import { cooldownMsFor, defaultChoiceFor } from '../../lib/decision-defaults.js';
import {
  SessionController,
  registerController,
  dropController,
  type ResolverChoice,
} from '../../runtime/SessionController.js';

const CAPABILITIES: readonly Capability[] = ['spawn', 'attach', 'send-message', 'stop'] as const;

export class SdkAgentAdapter implements AgentAdapter {
  readonly type = 'claude-code-local' as const;
  readonly capabilities = CAPABILITIES;

  async spawn(spec: SpawnSpec): Promise<AgentSession> {
    if (!spec.workingDirectory) {
      throw new Error('SDK adapter requires workingDirectory (worktree path)');
    }
    const startedAt = new Date().toISOString();

    const controller = new SessionController({
      cockpitSessionId: spec.cockpitSessionId,
      cockpitAgentId: spec.cockpitAgentId,
      cockpitProjectId: spec.cockpitProjectId,
    });
    registerController(controller);

    controller.publish('session.started', {
      workingDirectory: spec.workingDirectory,
      branch: spec.branch,
    });

    // Run the SDK loop in the background. We don't await — the route returns
    // immediately and the loop pumps events into the bus.
    void this.run(controller, spec)
      .catch((err) => {
        controller.publish('error', {
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        controller.publish('session.ended', { reason: 'sdk-loop-exited' });
        controller.markEnded();
        dropController(controller.refs.cockpitSessionId);
      });

    return {
      cockpitSessionId: spec.cockpitSessionId,
      externalId: `sdk:${spec.cockpitSessionId}`,
      startedAt,
    };
  }

  async *attach(cockpitSessionId: string): AsyncIterable<NormalisedEvent> {
    const queue: NormalisedEvent[] = [];
    let resolveNext: ((e: NormalisedEvent | null) => void) | null = null;
    const handler = (event: NormalisedEvent) => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(event);
      } else {
        queue.push(event);
      }
    };
    eventBus.on(`session:${cockpitSessionId}`, handler);
    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        const next = await new Promise<NormalisedEvent | null>((res) => {
          resolveNext = res;
        });
        if (!next) return;
        yield next;
      }
    } finally {
      eventBus.off(`session:${cockpitSessionId}`, handler);
    }
  }

  async send(_cockpitSessionId: string, _message: AgentMessage): Promise<void> {
    // Streaming-input mode would let us push messages into a live SDK session
    // mid-flight. For Phase 1 we keep spawn() one-shot and use canUseTool
    // resolution as the interactive surface. Follow-up replies are tracked
    // as a v0.2 task once we move spawn() to streaming-input mode.
  }

  async stop(cockpitSessionId: string): Promise<void> {
    const controller = (await import('../../runtime/SessionController.js')).getController(
      cockpitSessionId,
    );
    controller?.stop('user-stop');
  }

  // The SDK loop. Runs to completion or until the controller is aborted.
  private async run(controller: SessionController, spec: SpawnSpec): Promise<void> {
    const canUseTool: CanUseTool = async (toolName, input, opts) => {
      return await this.gateToolCall(controller, toolName, input, opts.toolUseID);
    };

    const notificationHook: HookCallback = async (input, _toolUseID, _opts) => {
      if (input.hook_event_name !== 'Notification') {
        return {} as HookJSONOutput;
      }
      // Volunteered ask: surface as a required scope-ambiguity decision.
      // Doesn't block the agent — Notification hooks aren't in the gating path.
      const decisionId = generateCockpitDecisionId();
      const event = controller.publish('notification', {
        message: input.message,
        notification_type: input.notification_type,
        title: input.title,
        __skipClassification: true,
      });
      const trigger = classify(event);
      if (trigger) {
        await this.writeDecision(controller, decisionId, event.cockpitEventId, trigger, {
          // No defaultChoice / expiresAt — required severity, must be answered.
        });
      }
      return {} as HookJSONOutput;
    };

    const iter = query({
      prompt: spec.task,
      options: {
        cwd: spec.workingDirectory!,
        abortController: { signal: controller.signal } as unknown as AbortController,
        // Reuse Claude Code's prompt + tool surface so we don't lose coding
        // capability vs. spawning the CLI directly.
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        // Cockpit gates via canUseTool. Default mode keeps Claude Code's
        // own permission rules as a backstop — they can ask, we then gate.
        permissionMode: 'default',
        canUseTool,
        hooks: {
          Notification: [{ hooks: [notificationHook] }],
        },
      },
    });

    for await (const message of iter) {
      this.consumeMessage(controller, message);
    }
  }

  // The gating callback. Returns a Promise that's only resolved when the
  // human picks an action in the queue (or the cooldown scheduler expires it).
  private async gateToolCall(
    controller: SessionController,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<PermissionResult> {
    // Synthesize a tool.pre event for the event log + portfolio map. We
    // classify inline (below) and write the decision ourselves so we can hold
    // a Promise on the result, so persistence.ts must NOT also classify —
    // the __skipClassification flag tells it to skip this event.
    const event = controller.publish('tool.pre', {
      toolName,
      command: typeof input.command === 'string' ? input.command : undefined,
      filePath:
        typeof input.file_path === 'string'
          ? input.file_path
          : typeof input.path === 'string'
            ? input.path
            : undefined,
      toolInput: input,
      toolUseId,
      __skipClassification: true,
    });
    const trigger = classify(event);
    if (!trigger) {
      // No human gate needed — the SDK already decided this was prompt-worthy
      // (canUseTool is only called when its own permissions would prompt), but
      // our policy says auto-allow. If we want stricter, raise here.
      return { behavior: 'allow', updatedInput: input };
    }

    const decisionId = generateCockpitDecisionId();
    const cooldownMs = cooldownMsFor(trigger.severity);
    const expiresAt = cooldownMs ? new Date(Date.now() + cooldownMs) : null;
    await this.writeDecision(controller, decisionId, event.cockpitEventId, trigger, {
      defaultChoice: defaultChoiceFor(trigger.severity),
      expiresAt: expiresAt?.toISOString(),
    });
    if (expiresAt) {
      void scheduleCooldown(decisionId, expiresAt).catch((err) =>
        console.error('[sdk-adapter] scheduleCooldown failed', err),
      );
    }

    const choice = await controller.awaitDecision(decisionId);
    return choiceToPermission(choice, input);
  }

  private async writeDecision(
    controller: SessionController,
    decisionId: string,
    eventId: string,
    trigger: ReturnType<typeof classify>,
    extras: { defaultChoice?: string; expiresAt?: string },
  ): Promise<void> {
    if (!trigger) return;
    const now = new Date().toISOString();
    const db = getCockpitDb();
    await db.insert(cockpitDecisions).values({
      cockpitDecisionId: decisionId,
      cockpitSessionId: controller.refs.cockpitSessionId,
      cockpitAgentId: controller.refs.cockpitAgentId,
      cockpitEventId: eventId,
      triggerType: trigger.triggerType,
      severity: trigger.severity,
      status: 'open',
      question: trigger.question,
      toolName: trigger.toolName,
      command: trigger.command,
      filePath: trigger.filePath,
      defaultChoice: extras.defaultChoice,
      expiresAt: extras.expiresAt,
      mode: 'pause-on-decision',
      createdAt: now,
    });
    if (trigger.severity === 'required') {
      await db
        .update(cockpitSessions)
        .set({ state: 'needs-decision' })
        .where(eq(cockpitSessions.cockpitSessionId, controller.refs.cockpitSessionId));
    }
    eventBus.emit('decision-created', { decisionId, trigger });
  }

  // Map every SDK message to a normalised event (or several).
  private consumeMessage(controller: SessionController, message: SDKMessage): void {
    switch (message.type) {
      case 'assistant': {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            controller.publish('text.delta', { text: block.text });
          } else if (block.type === 'tool_use') {
            // TodoWrite is the agent's plan — promote it to plan.updated.
            if (block.name === 'TodoWrite') {
              const items = extractPlanItems(block.input);
              if (items) {
                controller.publish('plan.updated', { items });
                void getCockpitDb()
                  .update(cockpitSessions)
                  .set({ currentTodos: items })
                  .where(eq(cockpitSessions.cockpitSessionId, controller.refs.cockpitSessionId))
                  .catch(() => {});
              }
            }
            // Note: tool.pre is published from canUseTool when gating fires.
            // We don't double-publish here.
          }
        }
        return;
      }
      case 'user': {
        for (const block of message.message.content) {
          if (block.type === 'tool_result') {
            controller.publish('tool.post', {
              toolUseId: block.tool_use_id,
              isError: block.is_error,
              content: block.content,
            });
          }
        }
        return;
      }
      case 'result': {
        const totalCost = 'total_cost_usd' in message ? message.total_cost_usd : undefined;
        controller.publish('cost.updated', {
          totalCostUsd: totalCost,
          numTurns: message.num_turns,
          isError: message.is_error,
          subtype: message.subtype,
        });
        return;
      }
      case 'tool_progress': {
        controller.publish('text.delta', {
          text: `[${message.tool_name} ${message.elapsed_time_seconds.toFixed(1)}s]`,
          stream: 'progress',
        });
        return;
      }
      default:
        return; // system/init/compact_boundary/etc. — ignore for now
    }
  }
}

function choiceToPermission(
  choice: ResolverChoice,
  originalInput: Record<string, unknown>,
): PermissionResult {
  switch (choice.kind) {
    case 'approved':
      return { behavior: 'allow', updatedInput: originalInput };
    case 'blocked':
      return {
        behavior: 'deny',
        message: choice.message ?? 'denied by cockpit',
        interrupt: choice.interrupt ?? false,
      };
    case 'replied':
      // Treat reply as deny-with-guidance — the model picks up the message
      // and adapts on its next turn rather than running the gated tool.
      return {
        behavior: 'deny',
        message: choice.reply,
        interrupt: false,
      };
  }
}

function extractPlanItems(input: unknown): PlanItem[] | null {
  if (!input || typeof input !== 'object') return null;
  const todos = (input as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const items: PlanItem[] = [];
  for (const t of todos) {
    if (!t || typeof t !== 'object') continue;
    const obj = t as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content : null;
    const status = obj.status;
    if (!content) continue;
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') continue;
    items.push({
      content,
      activeForm: typeof obj.activeForm === 'string' ? obj.activeForm : undefined,
      status,
    });
  }
  return items;
}
