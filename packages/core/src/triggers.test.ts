import { describe, expect, it } from 'vitest';
import { classify } from './triggers.js';
import type { NormalisedEvent } from './types.js';

function ev(
  type: NormalisedEvent['type'],
  payload: Record<string, unknown>,
): NormalisedEvent {
  return {
    cockpitEventId: 'ckev_test',
    cockpitSessionId: 'ckse_test',
    cockpitAgentId: 'ckag_test',
    type,
    timestamp: '2026-04-26T13:00:00.000Z',
    payload,
  };
}

describe('classify (card v2 enrichment)', () => {
  describe('notification → scope-ambiguity', () => {
    it('produces detail + evidence + no rejectOptions', () => {
      const t = classify(ev('notification', { message: 'Which timezone strategy?' }));
      expect(t).not.toBeNull();
      expect(t!.triggerType).toBe('scope-ambiguity');
      expect(t!.severity).toBe('required');
      expect(t!.detail).toBeDefined();
      expect(t!.evidenceLines).toEqual(['Which timezone strategy?']);
      // Direction questions are dialog-shaped — freeform reply only.
      expect(t!.rejectOptions).toBeUndefined();
    });
  });

  describe('tool.pre destructive-action', () => {
    it('matches rm -rf and produces structured reject options', () => {
      const t = classify(ev('tool.pre', { toolName: 'Bash', command: 'rm -rf /tmp/foo' }));
      expect(t).not.toBeNull();
      expect(t!.triggerType).toBe('destructive-action');
      expect(t!.severity).toBe('required');
      expect(t!.detail).toBeDefined();
      expect(t!.evidenceLines).toContain('$ rm -rf /tmp/foo');
      expect(t!.rejectOptions).toBeDefined();
      expect(t!.rejectOptions!.length).toBeGreaterThan(0);
    });

    it('uses payload.rationale when present', () => {
      const t = classify(
        ev('tool.pre', {
          toolName: 'Bash',
          command: 'rm -rf packages/*/tmp',
          rationale: 'cleanup',
        }),
      );
      expect(t!.detail).toBe('cleanup');
    });

    it('matches git push --force', () => {
      const t = classify(ev('tool.pre', { toolName: 'Bash', command: 'git push --force origin main' }));
      expect(t!.triggerType).toBe('destructive-action');
    });
  });

  describe('tool.pre security-concern', () => {
    it('matches sensitive .env path and produces redirect options', () => {
      const t = classify(ev('tool.pre', { toolName: 'Edit', filePath: '.env.example' }));
      expect(t!.triggerType).toBe('security-concern');
      expect(t!.severity).toBe('required');
      expect(t!.rejectOptions).toBeDefined();
      expect(t!.rejectOptions!.some((o) => o.id === 'redirect')).toBe(true);
    });

    it('matches credential pattern in command', () => {
      // SECRET_PATTERNS: /sk-[A-Za-z0-9]{20,}/ — alphanumeric only after sk-,
      // no hyphen mid-token. Use a realistic format with no separators.
      const t = classify(
        ev('tool.pre', {
          toolName: 'Bash',
          command: 'export ANTHROPIC_API_KEY=sk-12345abcdefghij67890klmnop',
        }),
      );
      expect(t!.triggerType).toBe('security-concern');
    });
  });

  describe('tool.post failed-validation', () => {
    it('classifies pnpm test failure with retry/change/skip options', () => {
      const t = classify(
        ev('tool.post', {
          toolName: 'Bash',
          command: 'pnpm test src/routes/orders.test.ts',
          exitCode: 1,
          stderr: 'FAIL  src/routes/orders.test.ts\n  ● test\n  Expected 20, got 21',
        }),
      );
      expect(t).not.toBeNull();
      expect(t!.triggerType).toBe('failed-validation');
      expect(t!.severity).toBe('advisory');
      expect(t!.question).toContain('test failed');
      expect(t!.evidenceLines).toBeDefined();
      // stderr tail keeps last 3 non-empty lines
      expect(t!.evidenceLines!.length).toBeLessThanOrEqual(3);
      expect(t!.rejectOptions!.map((o) => o.id)).toEqual(['retry', 'change-approach', 'skip']);
    });

    it('detects build vs test in question text', () => {
      const t = classify(
        ev('tool.post', { toolName: 'Bash', command: 'pnpm build', exitCode: 1 }),
      );
      expect(t!.question).toContain('build failed');
    });

    it('returns null for exit 0', () => {
      const t = classify(
        ev('tool.post', { toolName: 'Bash', command: 'pnpm test', exitCode: 0 }),
      );
      expect(t).toBeNull();
    });

    it('returns null when command does not look like validation', () => {
      const t = classify(
        ev('tool.post', { toolName: 'Bash', command: 'ls -la', exitCode: 1 }),
      );
      expect(t).toBeNull();
    });

    it('truncates very long stderr lines to 160 chars', () => {
      const longLine = 'a'.repeat(300);
      const t = classify(
        ev('tool.post', {
          toolName: 'Bash',
          command: 'pnpm test',
          exitCode: 1,
          stderr: longLine,
        }),
      );
      expect(t!.evidenceLines![0].length).toBeLessThanOrEqual(160);
      expect(t!.evidenceLines![0]).toMatch(/…$/);
    });
  });

  it('returns null for unhandled event types', () => {
    expect(classify(ev('text.delta', { text: 'hi' }))).toBeNull();
    expect(classify(ev('cost.updated', { totalCostUsd: 0.1 }))).toBeNull();
  });
});
