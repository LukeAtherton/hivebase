// Pure tests for the ticker-feed classifier. The exact rules here
// determine what shows up in the bottom-of-screen strip, so we pin
// each event-type's behaviour: included with the right severity, or
// skipped entirely (text deltas, tool spam, cost ticks).

import { describe, expect, it } from 'vitest';
import { classify } from '../src/lib/ticker-feed.js';
import type { NormalisedEvent } from '@kybernos/core';

function ev(type: NormalisedEvent['type'], payload: Record<string, unknown> = {}): NormalisedEvent {
  return {
    cockpitEventId: 'cke_test',
    cockpitSessionId: 'ckse_test',
    cockpitAgentId: 'ckag_test',
    type,
    timestamp: '2026-04-26T00:00:00Z',
    payload,
  };
}

describe('classify', () => {
  it('emits an "error" item for error events with severity required', () => {
    const item = classify(ev('error', { message: 'boom' }));
    expect(item?.kind).toBe('error');
    expect(item?.severity).toBe('required');
    expect(item?.message).toBe('boom');
    expect(item?.cockpitSessionId).toBe('ckse_test');
  });

  it('truncates long error messages to 140 characters', () => {
    const long = 'x'.repeat(500);
    const item = classify(ev('error', { message: long }));
    expect(item?.message.length).toBe(140);
  });

  it('emits a "notification" item for notification events with severity advisory', () => {
    const item = classify(ev('notification', { message: 'attention' }));
    expect(item?.kind).toBe('notification');
    expect(item?.severity).toBe('advisory');
  });

  it('emits a "session" item for session.started / session.ended', () => {
    const a = classify(ev('session.started'));
    const b = classify(ev('session.ended'));
    expect(a?.kind).toBe('session');
    expect(b?.kind).toBe('session');
    expect(a?.message).toBe('session started');
    expect(b?.message).toBe('session ended');
  });

  it('emits a "plan" item only when there is an in_progress task', () => {
    const skipped = classify(
      ev('plan.updated', { items: [{ content: 'do thing', status: 'pending' }] }),
    );
    expect(skipped).toBeNull();

    const surfaced = classify(
      ev('plan.updated', {
        items: [
          { content: 'first', status: 'completed' },
          { content: 'second', activeForm: 'Doing second', status: 'in_progress' },
        ],
      }),
    );
    expect(surfaced?.kind).toBe('plan');
    // Prefers activeForm over content when both are present.
    expect(surfaced?.message).toContain('Doing second');
  });

  it('falls back to content if activeForm is missing on the in_progress item', () => {
    const item = classify(
      ev('plan.updated', { items: [{ content: 'plain content', status: 'in_progress' }] }),
    );
    expect(item?.message).toContain('plain content');
  });

  it('returns null for plan events with no in_progress task at all', () => {
    expect(classify(ev('plan.updated', { items: [] }))).toBeNull();
    expect(
      classify(ev('plan.updated', { items: [{ content: 'a', status: 'completed' }] })),
    ).toBeNull();
  });

  it('skips firehose noise (text.delta, tool.pre, tool.post, cost.updated)', () => {
    expect(classify(ev('text.delta', { text: 'hi' }))).toBeNull();
    expect(classify(ev('tool.pre', { toolName: 'Bash' }))).toBeNull();
    expect(classify(ev('tool.post', { exitCode: 0 }))).toBeNull();
    expect(classify(ev('cost.updated', { totalCostUsd: 0.01 }))).toBeNull();
  });

  it('returns null for unknown event types', () => {
    expect(classify(ev('something-new' as NormalisedEvent['type']))).toBeNull();
  });
});
