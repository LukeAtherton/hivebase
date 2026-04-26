import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getCockpitDb, cockpitSessions } from '@swarm/platform';
import type {
  AgentAdapter,
  AgentMessage,
  AgentSession,
  Capability,
  NormalisedEvent,
  PlanItem,
  SpawnSpec,
} from '@swarm/core';
import { eventBus } from '../../lib/event-bus.js';
import {
  SessionController,
  registerController,
  dropController,
} from '../../runtime/SessionController.js';

// One active local Claude Code process per session.
// Streaming-input mode: stdin stays open across turns so send() can push
// follow-up user messages. Hook bridge handles gating (PreToolUse).
interface RunningSession {
  controller: SessionController;
  child: ChildProcess;
  workingDirectory: string;
  startedAt: string;
  // Buffer for partial JSON lines coming back on stdout.
  stdoutBuffer: string;
}

const running = new Map<string, RunningSession>();

const CAPABILITIES: readonly Capability[] = ['spawn', 'attach', 'send-message', 'stop'] as const;

// Hook bridge script (unchanged from gating spike). See COCKPIT_PLAN.md
// "Decision sources" for the protocol.
function hookScript(cockpitSessionId: string, hookEndpointUrl: string): string {
  const verdictEndpoint = hookEndpointUrl.replace(/\/hooks\/claude-code$/, '/hooks/verdict');
  return `#!/usr/bin/env bash
set -uo pipefail

PAYLOAD=$(cat)

RESP=$(curl -sS -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'X-Cockpit-Session-Id: ${cockpitSessionId}' \\
  --max-time 5 \\
  --data-binary "$PAYLOAD" \\
  '${hookEndpointUrl}' 2>/dev/null) || { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"cockpit unreachable"}}'; exit 0; }

VERDICT=$(echo "$RESP" | python3 -c 'import json,sys
try: d=json.load(sys.stdin); print(d.get("verdict",""))
except: print("")' 2>/dev/null)
DECISION_ID=$(echo "$RESP" | python3 -c 'import json,sys
try: d=json.load(sys.stdin); print(d.get("decisionId",""))
except: print("")' 2>/dev/null)

EVENT_NAME=$(echo "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("hook_event_name",""))
except: print("")' 2>/dev/null)
if [ "$EVENT_NAME" != "PreToolUse" ]; then
  exit 0
fi

if [ -n "$DECISION_ID" ]; then
  VERDICT_RESP=$(curl -sS \\
    --max-time 3600 \\
    "${verdictEndpoint}/$DECISION_ID" 2>/dev/null) || { echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"cockpit verdict timeout"}}'; exit 0; }
  VERDICT=$(echo "$VERDICT_RESP" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("verdict",""))
except: print("")' 2>/dev/null)
  REASON=$(echo "$VERDICT_RESP" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("reason",""))
except: print("")' 2>/dev/null)
fi

case "$VERDICT" in
  allow)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    ;;
  deny)
    REASON_JSON=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "\${REASON:-denied by cockpit}")
    echo "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"PreToolUse\\",\\"permissionDecision\\":\\"deny\\",\\"permissionDecisionReason\\":$REASON_JSON}}"
    ;;
  *)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}'
    ;;
esac
exit 0
`;
}

function hookSettings(scriptPath: string) {
  return {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: scriptPath }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: scriptPath }] }],
      // Claude Code fires PostToolUseFailure (not PostToolUse) when a tool
      // exits non-zero. Without this hook, npm-test/pytest/build failures
      // never reach the cockpit and failed-validation decisions never trigger.
      PostToolUseFailure: [{ matcher: '*', hooks: [{ type: 'command', command: scriptPath }] }],
      Notification: [{ hooks: [{ type: 'command', command: scriptPath }] }],
      Stop: [{ hooks: [{ type: 'command', command: scriptPath }] }],
    },
  };
}

export class ClaudeCodeLocalAdapter implements AgentAdapter {
  readonly type = 'claude-code-local' as const;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly hookEndpointUrl: string) {}

  async spawn(spec: SpawnSpec): Promise<AgentSession> {
    if (!spec.workingDirectory) {
      throw new Error('claude-code-local requires workingDirectory (worktree path)');
    }
    const cockpitDir = join(spec.workingDirectory, '.cockpit');
    const claudeDir = join(spec.workingDirectory, '.claude');
    await mkdir(cockpitDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });

    const scriptPath = join(cockpitDir, 'hook.sh');
    await writeFile(scriptPath, hookScript(spec.cockpitSessionId, this.hookEndpointUrl), {
      mode: 0o755,
    });
    await writeFile(
      join(claudeDir, 'settings.json'),
      JSON.stringify(hookSettings(scriptPath), null, 2),
    );

    const controller = new SessionController({
      cockpitSessionId: spec.cockpitSessionId,
      cockpitAgentId: spec.cockpitAgentId,
      cockpitProjectId: spec.cockpitProjectId,
    });
    registerController(controller);

    // Streaming-input mode: stdin remains open between turns. Each line on
    // stdin is a JSON message; each line on stdout is a JSON SDKMessage-shaped
    // event. send() writes additional user messages. stop() closes stdin.
    const child = spawn(
      'claude',
      [
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--print',
        '--verbose',
        '--include-partial-messages',
      ],
      {
        cwd: spec.workingDirectory,
        env: {
          ...process.env,
          COCKPIT_SESSION_ID: spec.cockpitSessionId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const startedAt = new Date().toISOString();
    const session: RunningSession = {
      controller,
      child,
      workingDirectory: spec.workingDirectory,
      startedAt,
      stdoutBuffer: '',
    };
    running.set(spec.cockpitSessionId, session);

    controller.publish('session.started', {
      pid: child.pid,
      workingDirectory: spec.workingDirectory,
    });

    child.stdout?.on('data', (buf: Buffer) => {
      session.stdoutBuffer += buf.toString('utf8');
      const lines = session.stdoutBuffer.split('\n');
      // Last element may be a partial line; keep it buffered.
      session.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        consumeJsonLine(controller, line);
      }
    });
    child.stderr?.on('data', (buf: Buffer) => {
      controller.publish('text.delta', { text: buf.toString('utf8'), stream: 'stderr' });
    });
    child.on('exit', (code, signal) => {
      // Flush any remaining buffered line.
      if (session.stdoutBuffer.trim()) {
        consumeJsonLine(controller, session.stdoutBuffer);
        session.stdoutBuffer = '';
      }
      controller.publish('session.ended', { exitCode: code, signal });
      controller.markEnded();
      dropController(spec.cockpitSessionId);
      running.delete(spec.cockpitSessionId);
    });

    // Send the initial task as the first user message.
    writeUserMessage(child, spec.task);

    // Bind controller's send hook so /decisions/:id/reply can deliver
    // follow-up messages to the live session.
    controller.sendUserMessage = async (message: AgentMessage) => {
      writeUserMessage(child, message.text);
    };

    return {
      cockpitSessionId: spec.cockpitSessionId,
      externalId: String(child.pid ?? ''),
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

  async send(cockpitSessionId: string, message: AgentMessage): Promise<void> {
    const session = running.get(cockpitSessionId);
    if (!session) return;
    if (!session.child.stdin || session.child.stdin.destroyed) return;
    writeUserMessage(session.child, message.text);
  }

  async stop(cockpitSessionId: string): Promise<void> {
    const session = running.get(cockpitSessionId);
    if (!session) return;
    session.controller.stop('user-stop');
    // Closing stdin lets claude shut down cleanly. SIGTERM after a beat if not.
    try {
      session.child.stdin?.end();
    } catch {
      /* already closed */
    }
    setTimeout(() => {
      if (!session.child.killed) session.child.kill('SIGTERM');
    }, 500).unref();
    setTimeout(() => {
      if (!session.child.killed) session.child.kill('SIGKILL');
    }, 2000).unref();
  }
}

// Write one user message into the streaming-input session.
function writeUserMessage(child: ChildProcess, text: string): void {
  if (!child.stdin || child.stdin.destroyed) return;
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  });
  child.stdin.write(line + '\n');
}

// Parse one JSON line from claude's stdout. Maps SDKMessage-shaped objects to
// NormalisedEvents. Anything we don't recognise is logged at debug-text level
// so it's still visible in the session detail view.
function consumeJsonLine(controller: SessionController, line: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    controller.publish('text.delta', { text: line + '\n', stream: 'stdout-raw' });
    return;
  }
  const msg = parsed as Record<string, unknown>;
  const type = msg['type'] as string | undefined;
  switch (type) {
    case 'assistant': {
      const message = msg['message'] as { content?: unknown[] } | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b['type'] === 'text' && typeof b['text'] === 'string') {
          controller.publish('text.delta', { text: b['text'] });
        } else if (b['type'] === 'tool_use') {
          // TodoWrite is the agent's plan — extract and publish plan.updated.
          if (b['name'] === 'TodoWrite') {
            const items = extractPlanItems(b['input']);
            if (items) {
              controller.publish('plan.updated', { items });
              void getCockpitDb()
                .update(cockpitSessions)
                .set({ currentTodos: items })
                .where(eq(cockpitSessions.cockpitSessionId, controller.refs.cockpitSessionId))
                .catch(() => {});
            }
          }
          // tool.pre is published by the hook bridge route; don't double-fire.
        }
      }
      return;
    }
    case 'user': {
      const message = msg['message'] as { content?: unknown[] } | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b['type'] === 'tool_result') {
          // tool.post is also published by hook bridge; skip to avoid duplicates.
        }
      }
      return;
    }
    case 'result': {
      const cost = typeof msg['total_cost_usd'] === 'number' ? msg['total_cost_usd'] : undefined;
      // Pull input/output tokens out of the result usage block — used by the
      // map's context-pressure height visual and by the LOAD readout.
      const usage = (msg['usage'] ?? {}) as Record<string, unknown>;
      const inputTokens =
        typeof usage['input_tokens'] === 'number' ? (usage['input_tokens'] as number) : 0;
      const cacheReadTokens =
        typeof usage['cache_read_input_tokens'] === 'number'
          ? (usage['cache_read_input_tokens'] as number)
          : 0;
      const cacheCreateTokens =
        typeof usage['cache_creation_input_tokens'] === 'number'
          ? (usage['cache_creation_input_tokens'] as number)
          : 0;
      const outputTokens =
        typeof usage['output_tokens'] === 'number' ? (usage['output_tokens'] as number) : 0;
      // Effective context size = fresh input + cache reads + cache creates +
      // output tokens (everything contributing to the prompt window).
      const turnTokens = inputTokens + cacheReadTokens + cacheCreateTokens + outputTokens;
      controller.publish('cost.updated', {
        totalCostUsd: cost,
        numTurns: msg['num_turns'],
        isError: msg['is_error'],
        subtype: msg['subtype'],
        turnTokens,
        inputTokens,
        outputTokens,
      });
      return;
    }
    case 'system':
      // init / status / hook_response / etc — quiet for now, persisted via
      // raw-json fallback below if anything interesting shows up.
      return;
    case 'rate_limit_event':
    case 'stream_event':
      // Partial-message chunks; we publish on full assistant blocks instead.
      return;
    default:
      // Surface unknown shapes as text so they're not silently dropped.
      controller.publish('text.delta', { text: line + '\n', stream: 'stdout-json' });
      return;
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
