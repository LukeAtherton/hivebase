// Map a ClassifiedTrigger output to an AutonomyCapability.
//
// The trigger-type → capability mapping is mostly direct, with some
// secondary inference from the command/filePath when the trigger is
// generic ('failed-validation' covers tests, builds, typechecks, lints
// — all distinct capabilities).
//
// The autonomy gate consults this once per classifier hit to decide
// which row to read out of cockpit_autonomy_policies.

import type { AutonomyCapability } from './types.js';
import type { ClassifiedTrigger } from './triggers.js';

const TEST_PATTERN = /\b(test|jest|vitest|mocha|pytest)\b/i;
const BUILD_PATTERN = /\b(build|tsc|webpack|vite|rollup)\b/i;
const LINT_PATTERN = /\b(lint|eslint|prettier|stylelint)\b/i;

export function mapTriggerToCapability(trigger: ClassifiedTrigger): AutonomyCapability {
  const cmd = trigger.command ?? '';

  switch (trigger.triggerType) {
    case 'destructive-action':
      return 'destructive';
    case 'security-concern':
      // Sensitive-path edits are file edits at heart; the security framing is
      // about WHERE the edit lands, not what kind of action it is. The autonomy
      // policy for 'edit-files' applies; a stricter operator would tighten that
      // to 'never' for high-risk paths via per-agent overrides.
      return 'edit-files';
    case 'merge-conflict':
      // Merge conflicts surface at git push / PR time. Treat as push-branch.
      return 'push-branch';
    case 'spend-threshold':
    case 'time-threshold':
      return 'spend-over-threshold';
    case 'scope-ambiguity':
    case 'architectural-tradeoff':
      // These are direction questions, not gateable actions; the gate
      // short-circuits via triggerIsAlwaysHuman() before this is consulted.
      // The value here is irrelevant; pick the closest match defensively.
      return 'spend-over-threshold';
    case 'failed-validation': {
      // Sub-classify by the command.
      if (BUILD_PATTERN.test(cmd)) return 'run-build';
      if (LINT_PATTERN.test(cmd)) return 'run-tests';
      if (TEST_PATTERN.test(cmd)) return 'run-tests';
      return 'run-tests';
    }
    default:
      return 'edit-files';
  }
}

// Triggers that are inherently questions for the operator — they should
// never be auto-resolved by the policy gate, even if the agent's
// capability says 'allow'.
export function triggerIsAlwaysHuman(trigger: ClassifiedTrigger): boolean {
  return (
    trigger.triggerType === 'scope-ambiguity' ||
    trigger.triggerType === 'architectural-tradeoff'
  );
}
