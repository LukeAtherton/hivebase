import { describe, expect, it } from 'vitest';
import { mapTriggerToCapability, triggerIsAlwaysHuman } from './autonomy.js';
import type { ClassifiedTrigger } from './triggers.js';

// Helper: build a minimal ClassifiedTrigger for tests.
function trig(partial: Partial<ClassifiedTrigger> & Pick<ClassifiedTrigger, 'triggerType'>): ClassifiedTrigger {
  return {
    severity: 'advisory',
    question: 'q',
    ...partial,
  } as ClassifiedTrigger;
}

describe('mapTriggerToCapability', () => {
  it('maps destructive-action to destructive', () => {
    expect(mapTriggerToCapability(trig({ triggerType: 'destructive-action' }))).toBe('destructive');
  });

  it('maps security-concern to edit-files', () => {
    // Sensitive-path edits are file edits; security framing is about WHERE.
    expect(mapTriggerToCapability(trig({ triggerType: 'security-concern' }))).toBe('edit-files');
  });

  it('maps merge-conflict to push-branch', () => {
    expect(mapTriggerToCapability(trig({ triggerType: 'merge-conflict' }))).toBe('push-branch');
  });

  it('maps spend-threshold and time-threshold to spend-over-threshold', () => {
    expect(mapTriggerToCapability(trig({ triggerType: 'spend-threshold' }))).toBe('spend-over-threshold');
    expect(mapTriggerToCapability(trig({ triggerType: 'time-threshold' }))).toBe('spend-over-threshold');
  });

  describe('failed-validation sub-classification', () => {
    it('maps build commands to run-build', () => {
      expect(
        mapTriggerToCapability(
          trig({ triggerType: 'failed-validation', command: 'pnpm build' }),
        ),
      ).toBe('run-build');
      expect(
        mapTriggerToCapability(
          trig({ triggerType: 'failed-validation', command: 'tsc --noEmit' }),
        ),
      ).toBe('run-build');
    });

    it('maps test commands to run-tests', () => {
      expect(
        mapTriggerToCapability(
          trig({ triggerType: 'failed-validation', command: 'pnpm test src/foo.test.ts' }),
        ),
      ).toBe('run-tests');
      expect(
        mapTriggerToCapability(
          trig({ triggerType: 'failed-validation', command: 'vitest run' }),
        ),
      ).toBe('run-tests');
    });

    it('falls back to run-tests for unrecognised commands', () => {
      expect(
        mapTriggerToCapability(trig({ triggerType: 'failed-validation', command: 'frobnicate' })),
      ).toBe('run-tests');
    });
  });

  it('returns a defined value for scope-ambiguity even though gate short-circuits it', () => {
    // The autonomy gate short-circuits scope-ambiguity via triggerIsAlwaysHuman
    // BEFORE consulting this. The value here is irrelevant in practice but the
    // function must still return one of the AutonomyCapability literal types.
    const result = mapTriggerToCapability(trig({ triggerType: 'scope-ambiguity' }));
    expect(typeof result).toBe('string');
  });
});

describe('triggerIsAlwaysHuman', () => {
  it('returns true for direction-question triggers', () => {
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'scope-ambiguity' }))).toBe(true);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'architectural-tradeoff' }))).toBe(true);
  });

  it('returns false for gateable action triggers', () => {
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'destructive-action' }))).toBe(false);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'security-concern' }))).toBe(false);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'failed-validation' }))).toBe(false);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'merge-conflict' }))).toBe(false);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'spend-threshold' }))).toBe(false);
    expect(triggerIsAlwaysHuman(trig({ triggerType: 'time-threshold' }))).toBe(false);
  });
});
