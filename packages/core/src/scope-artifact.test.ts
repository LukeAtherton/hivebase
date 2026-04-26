import { describe, expect, it } from 'vitest';
import {
  renderScopeArtifactForAgent,
  scopeArtifactReadyToAgree,
} from './types.js';
import type { ScopeArtifact } from './types.js';

function fixture(partial: Partial<ScopeArtifact> = {}): ScopeArtifact {
  return {
    cockpitScopeArtifactId: 'cksa_test',
    cockpitSessionId: 'ckse_test',
    cockpitProjectId: 'ckpr_test',
    status: 'draft',
    task: '',
    acceptanceCriteria: [],
    nonGoals: [],
    touchSurface: [],
    autonomyPreset: 'trusted-default',
    supersededBy: null,
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    agreedAt: null,
    ...partial,
  };
}

describe('scopeArtifactReadyToAgree', () => {
  it('rejects empty task', () => {
    expect(scopeArtifactReadyToAgree(fixture())).toBe(false);
  });

  it('rejects whitespace-only task', () => {
    expect(scopeArtifactReadyToAgree(fixture({ task: '   ' }))).toBe(false);
  });

  it('rejects task with no criteria', () => {
    expect(
      scopeArtifactReadyToAgree(fixture({ task: 'do the thing', acceptanceCriteria: [] })),
    ).toBe(false);
  });

  it('accepts task + ≥1 criterion', () => {
    expect(
      scopeArtifactReadyToAgree(
        fixture({ task: 'do the thing', acceptanceCriteria: ['it works'] }),
      ),
    ).toBe(true);
  });
});

describe('renderScopeArtifactForAgent', () => {
  it('renders a minimal artifact with task only', () => {
    const out = renderScopeArtifactForAgent(
      fixture({ task: 'Refactor /api/profile.', acceptanceCriteria: [] }),
    );
    expect(out).toContain('# Agreed scope');
    expect(out).toContain('## Task');
    expect(out).toContain('Refactor /api/profile.');
    expect(out).not.toContain('## Acceptance criteria');
    expect(out).not.toContain('## Non-goals');
    expect(out).not.toContain('## Touch surface');
  });

  it('renders all sections when populated', () => {
    const out = renderScopeArtifactForAgent(
      fixture({
        task: 'Refactor auth middleware.',
        acceptanceCriteria: ['Tests still pass', 'No new env vars'],
        nonGoals: ['Do not touch the public API'],
        touchSurface: ['src/middleware/auth.ts', 'src/middleware/auth.test.ts'],
        autonomyPreset: 'sandboxed',
      }),
    );
    expect(out).toContain('Refactor auth middleware.');
    expect(out).toContain('- Tests still pass');
    expect(out).toContain('- No new env vars');
    expect(out).toContain('## Non-goals (do NOT do these)');
    expect(out).toContain('- Do not touch the public API');
    expect(out).toContain('## Touch surface');
    expect(out).toContain('- src/middleware/auth.ts');
    expect(out).toContain('Autonomy preset: sandboxed.');
  });

  it('orders sections deterministically (task → criteria → non-goals → touch surface)', () => {
    const out = renderScopeArtifactForAgent(
      fixture({
        task: 'T',
        acceptanceCriteria: ['C'],
        nonGoals: ['N'],
        touchSurface: ['F'],
      }),
    );
    const taskIdx = out.indexOf('## Task');
    const critIdx = out.indexOf('## Acceptance criteria');
    const ngIdx = out.indexOf('## Non-goals');
    const tsIdx = out.indexOf('## Touch surface');
    expect(taskIdx).toBeLessThan(critIdx);
    expect(critIdx).toBeLessThan(ngIdx);
    expect(ngIdx).toBeLessThan(tsIdx);
  });

  it('reminds the agent not to expand scope unilaterally', () => {
    // This is load-bearing — per agent-handoff-decision.md the impl agent
    // must surface scope-questions instead of silently widening scope.
    const out = renderScopeArtifactForAgent(fixture({ task: 'x', acceptanceCriteria: ['y'] }));
    expect(out).toMatch(/scope-question|expanding scope/i);
  });
});
