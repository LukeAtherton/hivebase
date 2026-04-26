import { describe, expect, it } from 'vitest';
import { stageFromSessionState, AUTONOMY_CAPABILITIES, AGENT_STAGES } from './types.js';
import type { SessionState } from './types.js';

describe('stageFromSessionState', () => {
  it('maps queued and orienting to scoping', () => {
    expect(stageFromSessionState('queued')).toBe('scoping');
    expect(stageFromSessionState('orienting')).toBe('scoping');
  });

  it('maps ready-for-review to verification', () => {
    expect(stageFromSessionState('ready-for-review')).toBe('verification');
  });

  it('maps active implementation states to implementation', () => {
    const implStates: SessionState[] = [
      'implementing',
      'validating',
      'blocked',
      'needs-decision',
      'merged',
      'stale-zombie',
      'stopped',
    ];
    for (const s of implStates) {
      expect(stageFromSessionState(s)).toBe('implementation');
    }
  });
});

describe('autonomy constants', () => {
  it('AUTONOMY_CAPABILITIES has the expected 13 entries', () => {
    expect(AUTONOMY_CAPABILITIES).toHaveLength(13);
    // Spot-check a few that the gate logic relies on.
    expect(AUTONOMY_CAPABILITIES).toContain('edit-files');
    expect(AUTONOMY_CAPABILITIES).toContain('run-tests');
    expect(AUTONOMY_CAPABILITIES).toContain('destructive');
  });

  it('AGENT_STAGES is exactly the three lifecycle stages', () => {
    expect([...AGENT_STAGES]).toEqual(['scoping', 'implementation', 'verification']);
  });
});
