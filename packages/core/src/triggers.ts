// Trigger classification — the rules that turn raw events into decisions.
// Adapter-agnostic. Adapters call classify() on every NormalisedEvent and
// the cockpit-api decides whether to write a cockpit_decisions row.

import type { NormalisedEvent, Severity, TriggerType } from './types.js';

export interface RejectOption {
  // Stable id so the UI can render the same set of buttons each time.
  id: string;
  label: string;
  // Pre-filled freeform reply text. The backend's /reply endpoint receives
  // this; the agent sees it as the deny reason in the next-turn context.
  reply: string;
}

export interface ClassifiedTrigger {
  triggerType: TriggerType;
  severity: Severity;
  // Short summary — fits in a card header. Can be a question.
  question: string;
  // 1-2 sentence "what is the agent trying to do" line under the question.
  // Card v2 surfaces this so the operator doesn't need to click into
  // SessionDetail to learn what the action is for.
  detail?: string;
  // Up to 3 lines of evidence (stderr tail, the ambiguous message, the
  // changed paths). Pulled from event payload by the classifier so the
  // operator sees them on the card itself — Pirolli scent on the queue.
  evidenceLines?: string[];
  // Templated reject replies. When the operator clicks one of these the
  // /reply endpoint fires with the pre-filled text. Skipping this field
  // means the card falls back to the freeform reply form.
  rejectOptions?: RejectOption[];
  toolName?: string;
  command?: string;
  filePath?: string;
}

// Patterns that always demand human approval, regardless of autonomy policy.
// These are the "destructive action pending" row from the plan.
const DESTRUCTIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+-rf?\b/i, label: 'recursive delete' },
  { pattern: /\bgit\s+push\s+(-f|--force)/i, label: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard/i, label: 'hard reset' },
  { pattern: /\bgit\s+branch\s+-D\b/i, label: 'force-delete branch' },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, label: 'drop schema' },
  { pattern: /\btruncate\s+table\b/i, label: 'truncate table' },
  { pattern: /\bDELETE\s+FROM\b/i, label: 'unscoped DELETE' },
  { pattern: /\bmigrate\s+(deploy|reset|push)\b/i, label: 'migration' },
];

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]+/,
];

// Files whose path alone elevates severity.
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /\.env(\.|$)/,
  /credentials?\.(json|yaml|yml)$/i,
  /id_rsa|id_ed25519/,
];

export function classify(event: NormalisedEvent): ClassifiedTrigger | null {
  switch (event.type) {
    case 'notification': {
      // Claude Code Notification hook — agent explicitly asks for input.
      const message = stringField(event.payload, 'message') ?? 'Agent is requesting input';
      return {
        triggerType: 'scope-ambiguity',
        severity: 'required',
        question: message,
        // Notification messages already carry the agent's framing; surface
        // them as the evidence so the operator sees the question + context
        // without scrolling.
        detail: 'Agent paused to ask for direction.',
        evidenceLines: [message].slice(0, 3),
        // Scope-ambiguity decisions are dialog-shaped; freeform reply
        // covers them better than templated rejects, which is why
        // rejectOptions is intentionally omitted here.
      };
    }

    case 'tool.pre': {
      const toolName = stringField(event.payload, 'toolName');
      const command = stringField(event.payload, 'command');
      const filePath = stringField(event.payload, 'filePath');

      // Destructive command match
      if (command) {
        for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
          if (pattern.test(command)) {
            return {
              triggerType: 'destructive-action',
              severity: 'required',
              question: `Approve ${label}?`,
              detail: rationaleFromPayload(event.payload) ?? `Agent intends to run \`${command}\`.`,
              evidenceLines: evidenceFromCommand(command, filePath, event.payload),
              rejectOptions: [
                { id: 'too-broad', label: 'too broad — narrow it', reply: 'Stop. The scope is too wide; narrow the target list and re-ask.' },
                { id: 'wrong-approach', label: 'change approach', reply: "Don't do this; pick a non-destructive alternative." },
              ],
              toolName,
              command,
              filePath,
            };
          }
        }
        // Secret in command-line
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(command)) {
            return {
              triggerType: 'security-concern',
              severity: 'required',
              question: 'Possible credential in command — approve?',
              detail: 'Command line appears to contain a credential pattern.',
              evidenceLines: evidenceFromCommand(command, filePath, event.payload),
              rejectOptions: [
                { id: 'redact', label: 'redact + retry', reply: 'Redact the credential, use an env-var reference instead, then retry.' },
              ],
              toolName,
              command,
              filePath,
            };
          }
        }
      }

      // Edits to sensitive files
      if (filePath) {
        for (const pattern of SENSITIVE_PATH_PATTERNS) {
          if (pattern.test(filePath)) {
            return {
              triggerType: 'security-concern',
              severity: 'required',
              question: `Approve write to sensitive path ${filePath}?`,
              detail: rationaleFromPayload(event.payload) ?? `Agent wants to edit a sensitive-path file: ${filePath}.`,
              evidenceLines: evidenceFromCommand(command, filePath, event.payload),
              rejectOptions: [
                { id: 'redirect', label: 'edit elsewhere', reply: `Don't edit ${filePath}; use the example/template file instead.` },
                { id: 'explain', label: 'explain why', reply: `Explain why this edit to ${filePath} is needed before proceeding.` },
              ],
              toolName,
              filePath,
            };
          }
        }
      }

      return null;
    }

    case 'tool.post': {
      const exitCode = numberField(event.payload, 'exitCode');
      const toolName = stringField(event.payload, 'toolName');
      const command = stringField(event.payload, 'command');
      const stderr = stringField(event.payload, 'stderr');
      // Non-zero exit on test/typecheck/build is a "failed validation" trigger.
      // We match on the toolName (e.g. Bash) AND on the command (e.g. `npm test`,
      // `pytest`, `npx tsc`, `cargo build`, `go test`) so the common case of
      // a test-runner invoked via Bash gets surfaced.
      // Match `pnpm test`, `pnpm run test`, `pnpm build`, `npm run typecheck`,
      // `yarn lint`, etc. The `(run\s+)?` makes `run` optional — modern
      // Turbo / pnpm scripts let you call `pnpm build` directly without
      // `run`, and the original regex missed those.
      const looksLikeValidation =
        (toolName && /test|typecheck|build|lint/i.test(toolName)) ||
        (command &&
          /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(test|t|typecheck|build|lint)\b/i.test(command)) ||
        (command && /\b(pytest|jest|vitest|mocha|tsc|eslint)\b/i.test(command)) ||
        (command && /\b(cargo|go|rustc|maven|gradle)\s+(test|build)\b/i.test(command));
      if (exitCode !== null && exitCode !== 0 && looksLikeValidation) {
        const label = command ? command.split(' ').slice(0, 3).join(' ') : (toolName ?? 'check');
        const isTest = !!(command && /\btest\b/.test(command));
        const isBuild = !!(command && /\bbuild\b/.test(command));
        const isLint = !!(command && /\blint\b/.test(command));
        const kind = isTest ? 'test' : isBuild ? 'build' : isLint ? 'lint' : 'check';
        return {
          triggerType: 'failed-validation',
          severity: 'advisory',
          question: `${kind} failed — retry, change approach, or block?`,
          detail: command
            ? `Agent ran \`${command}\` (exit ${exitCode}).`
            : `${toolName ?? 'Tool'} exited ${exitCode}.`,
          evidenceLines: stderrTail(stderr),
          rejectOptions: [
            { id: 'retry', label: 'retry as-is', reply: 'Try again with the same approach.' },
            { id: 'change-approach', label: 'change approach', reply: "Pause — let's rethink this; explain the alternatives before proceeding." },
            { id: 'skip', label: 'skip this check', reply: 'Skip this check for now and continue.' },
          ],
          toolName,
          command,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// --- helpers --------------------------------------------------------------

// Pull the last 3 non-empty lines out of a stderr blob. Truncates each line
// to 160 chars so a single huge stack frame can't blow out the card.
function stderrTail(stderr: string | undefined): string[] | undefined {
  if (!stderr) return undefined;
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  return lines
    .slice(-3)
    .map((l) => (l.length > 160 ? l.slice(0, 157) + '…' : l));
}

// Build a 1-3 line evidence summary from whatever the payload offers.
// Kept generic — the classifier can't know every adapter's payload shape,
// so we fall back to whichever fields are present.
function evidenceFromCommand(
  command: string | undefined,
  filePath: string | undefined,
  payload: Record<string, unknown>,
): string[] | undefined {
  const lines: string[] = [];
  if (command) lines.push(`$ ${command}`);
  if (filePath && filePath !== command) lines.push(`path: ${filePath}`);
  // Look for an `affectedPaths` array (some adapters produce these for
  // glob commands like `rm -rf packages/*/tmp`).
  const affected = payload['affectedPaths'];
  if (Array.isArray(affected) && affected.length > 0) {
    lines.push(`matched: ${affected.slice(0, 3).join(', ')}${affected.length > 3 ? `, +${affected.length - 3} more` : ''}`);
  }
  return lines.length > 0 ? lines.slice(0, 3) : undefined;
}

// Some adapters surface an explicit `rationale` or `intent` string; if so,
// use it as the human-friendly detail.
function rationaleFromPayload(payload: Record<string, unknown>): string | undefined {
  const rationale = payload['rationale'];
  if (typeof rationale === 'string' && rationale.length > 0) return rationale;
  const intent = payload['intent'];
  if (typeof intent === 'string' && intent.length > 0) return intent;
  return undefined;
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === 'number' ? v : null;
}
