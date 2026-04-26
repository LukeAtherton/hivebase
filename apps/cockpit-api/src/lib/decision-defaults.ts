import type { Severity } from '@swarm/core';

// Default action a cooldown applies on expiry.
// `info` and `advisory` get a non-blocking default; `required` has no default —
// the human must answer or the agent stays paused indefinitely.
export function defaultChoiceFor(severity: Severity): string | undefined {
  switch (severity) {
    case 'info':
      return 'dismiss';
    case 'advisory':
      return 'approve';
    case 'required':
      return undefined;
  }
}

// Cooldown duration in ms. null = never auto-expire.
export function cooldownMsFor(severity: Severity): number | null {
  switch (severity) {
    case 'info':
      return 30 * 1000;
    case 'advisory':
      return 60 * 1000;
    case 'required':
      return null;
  }
}
