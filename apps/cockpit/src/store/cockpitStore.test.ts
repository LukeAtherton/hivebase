// Tests for cockpit-store side-effecting actions, focused on the
// redirect lifecycle. These are the bits SessionDetail + DecisionCard
// rely on; getting them wrong silently turns the redirect button into
// "send a normal message" or strands a stale draft.

import { beforeEach, describe, expect, it } from 'vitest';
import { useCockpitStore } from './cockpitStore.js';

function reset() {
  useCockpitStore.setState({
    selectedSessionId: null,
    hoveredSessionId: null,
    hoveredTerritoryId: null,
    focusedDecisionId: null,
    redirectingDecisionId: null,
    selectedTile: null,
    spawnModalOpen: false,
    spawnModalPreset: null,
    scopingSurfaceOpen: false,
    scopingTargetProjectId: null,
    keymapOpen: false,
    toasts: [],
    recentEventTimes: [],
  });
}

describe('startRedirect', () => {
  beforeEach(reset);

  it('sets redirectingDecisionId, selects the session, focuses the decision', () => {
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    const s = useCockpitStore.getState();
    expect(s.redirectingDecisionId).toBe('dec-1');
    expect(s.selectedSessionId).toBe('sess-1');
    expect(s.focusedDecisionId).toBe('dec-1');
  });

  it('does NOT toast when starting from a clean state', () => {
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    expect(useCockpitStore.getState().toasts).toHaveLength(0);
  });

  it('does NOT toast when re-clicking redirect on the same decision', () => {
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    expect(useCockpitStore.getState().toasts).toHaveLength(0);
  });

  it('toasts when switching to a different decision (replace + warn)', () => {
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    useCockpitStore.getState().startRedirect('dec-2', 'sess-2');
    const s = useCockpitStore.getState();
    expect(s.redirectingDecisionId).toBe('dec-2');
    expect(s.selectedSessionId).toBe('sess-2');
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0].kind).toBe('info');
    expect(s.toasts[0].text).toMatch(/discarded/i);
  });
});

describe('cancelRedirect', () => {
  beforeEach(reset);

  it('clears redirectingDecisionId without affecting the selected session', () => {
    useCockpitStore.getState().startRedirect('dec-1', 'sess-1');
    useCockpitStore.getState().cancelRedirect();
    const s = useCockpitStore.getState();
    expect(s.redirectingDecisionId).toBeNull();
    // SessionDetail stays open after cancel — operator can keep
    // composing a normal message.
    expect(s.selectedSessionId).toBe('sess-1');
    expect(s.focusedDecisionId).toBe('dec-1');
  });

  it('is a no-op when no redirect is active', () => {
    useCockpitStore.getState().cancelRedirect();
    expect(useCockpitStore.getState().redirectingDecisionId).toBeNull();
  });
});

describe('openSpawnModal', () => {
  beforeEach(reset);

  it('opens the modal with no preset by default', () => {
    useCockpitStore.getState().openSpawnModal();
    const s = useCockpitStore.getState();
    expect(s.spawnModalOpen).toBe(true);
    expect(s.spawnModalPreset).toBeNull();
  });

  it('opens with a project preset when supplied', () => {
    useCockpitStore.getState().openSpawnModal({ projectId: 'p1' });
    const s = useCockpitStore.getState();
    expect(s.spawnModalOpen).toBe(true);
    expect(s.spawnModalPreset).toEqual({ projectId: 'p1' });
  });

  it('opens with new-project mode when supplied', () => {
    useCockpitStore.getState().openSpawnModal({ mode: 'new' });
    expect(useCockpitStore.getState().spawnModalPreset).toEqual({ mode: 'new' });
  });

  it('clears the preset when the modal is closed', () => {
    useCockpitStore.getState().openSpawnModal({ projectId: 'p1' });
    useCockpitStore.getState().setSpawnModal(false);
    const s = useCockpitStore.getState();
    expect(s.spawnModalOpen).toBe(false);
    expect(s.spawnModalPreset).toBeNull();
  });

  it('keeps the modal open and resets preset when re-opened plain', () => {
    useCockpitStore.getState().openSpawnModal({ projectId: 'p1' });
    useCockpitStore.getState().openSpawnModal();
    const s = useCockpitStore.getState();
    expect(s.spawnModalOpen).toBe(true);
    expect(s.spawnModalPreset).toBeNull();
  });
});

describe('setScopingSurface', () => {
  beforeEach(reset);

  it('clears scopingTargetProjectId when closed', () => {
    useCockpitStore.getState().openScopingForProject('p1');
    expect(useCockpitStore.getState().scopingTargetProjectId).toBe('p1');
    useCockpitStore.getState().setScopingSurface(false);
    const s = useCockpitStore.getState();
    expect(s.scopingSurfaceOpen).toBe(false);
    expect(s.scopingTargetProjectId).toBeNull();
  });
});

describe('recordEvent', () => {
  beforeEach(reset);

  it('appends a recent timestamp', () => {
    useCockpitStore.getState().recordEvent();
    expect(useCockpitStore.getState().recentEventTimes).toHaveLength(1);
  });

  it('trims entries older than 5 minutes', () => {
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    useCockpitStore.setState({ recentEventTimes: [sixMinAgo] });
    useCockpitStore.getState().recordEvent();
    const out = useCockpitStore.getState().recentEventTimes;
    expect(out).toHaveLength(1);
    expect(out[0]).toBeGreaterThan(sixMinAgo); // old one was dropped
  });
});
