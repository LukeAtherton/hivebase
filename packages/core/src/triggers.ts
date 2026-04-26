// Trigger classification — the rules that turn raw events into decisions.
// Adapter-agnostic. Adapters call classify() on every NormalisedEvent and
// the cockpit-api decides whether to write a cockpit_decisions row.

import type { NormalisedEvent, Severity, TriggerType } from './types.js';

export interface ClassifiedTrigger {
  triggerType: TriggerType;
  severity: Severity;
  question: string;
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
      // Non-zero exit on test/typecheck/build is a "failed validation" trigger.
      // We match on the toolName (e.g. Bash) AND on the command (e.g. `npm test`,
      // `pytest`, `npx tsc`, `cargo build`, `go test`) so the common case of
      // a test-runner invoked via Bash gets surfaced.
      const looksLikeValidation =
        (toolName && /test|typecheck|build|lint/i.test(toolName)) ||
        (command &&
          /\b(npm|pnpm|yarn|bun)\s+(test|t|run\s+test|run\s+typecheck|run\s+build|run\s+lint)\b/i.test(
            command,
          )) ||
        (command && /\b(pytest|jest|vitest|mocha|tsc|eslint)\b/i.test(command)) ||
        (command && /\b(cargo|go|rustc|maven|gradle)\s+(test|build)\b/i.test(command));
      if (exitCode !== null && exitCode !== 0 && looksLikeValidation) {
        const label = command ? command.split(' ').slice(0, 3).join(' ') : (toolName ?? 'check');
        return {
          triggerType: 'failed-validation',
          severity: 'advisory',
          question: `${label} failed (exit ${exitCode})`,
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

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === 'number' ? v : null;
}
