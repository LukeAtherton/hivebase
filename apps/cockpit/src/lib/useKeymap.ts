import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type DecisionRow, type SessionRow } from './api';
import { useCockpitStore } from '../store/cockpitStore';

// Sessions hidden from the canvas — kept in sync with isLiveOnMap in
// scene/PortfolioMap.tsx. Shift+J/K skips these so keyboard nav matches
// what the operator can actually see.
const HIDDEN_STATES = new Set(['merged', 'stopped', 'stale-zombie']);

// Single global keymap. Lives on the App so all routes share it.
//
// Bindings (when not typing in an input/textarea):
//   j / k             cycle focus through visible decisions
//   shift+j / shift+k cycle through live agents (canvas-visible)
//   l                 open detail panel (or focus its textarea if open)
//   h                 close detail panel (focused decision stays selected)
//   Enter / a         approve focused decision
//   i                 start redirect on focused decision (opens detail
//                     and auto-focuses the redirect textarea)
//   Esc               cancel redirect → close detail → close modals → clear focus
//   n                 open spawn modal
//   ?                 toggle keymap overlay
export function useKeymap(decisions: DecisionRow[], sessions: SessionRow[] = []) {
  const qc = useQueryClient();
  const focusedDecisionId = useCockpitStore((s) => s.focusedDecisionId);
  const setFocusedDecision = useCockpitStore((s) => s.setFocusedDecision);
  const setSelected = useCockpitStore((s) => s.setSelected);
  const setSpawnModal = useCockpitStore((s) => s.setSpawnModal);
  const setKeymapOpen = useCockpitStore((s) => s.setKeymapOpen);
  const spawnModalOpen = useCockpitStore((s) => s.spawnModalOpen);
  const selectedSessionId = useCockpitStore((s) => s.selectedSessionId);
  const keymapOpen = useCockpitStore((s) => s.keymapOpen);
  const startRedirect = useCockpitStore((s) => s.startRedirect);

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function focusedIndex(): number {
      if (!focusedDecisionId) return -1;
      return decisions.findIndex((d) => d.cockpitDecisionId === focusedDecisionId);
    }

    function move(delta: number) {
      if (decisions.length === 0) return;
      const cur = focusedIndex();
      const next = cur === -1 ? 0 : (cur + delta + decisions.length) % decisions.length;
      setFocusedDecision(decisions[next].cockpitDecisionId);
    }

    function moveSession(delta: number) {
      // Live, canvas-visible sessions only — matches isLiveOnMap.
      const live = sessions.filter((s) => !HIDDEN_STATES.has(s.state));
      if (live.length === 0) return;
      const cur = selectedSessionId
        ? live.findIndex((s) => s.cockpitSessionId === selectedSessionId)
        : -1;
      const next = cur === -1 ? 0 : (cur + delta + live.length) % live.length;
      setSelected(live[next].cockpitSessionId);
    }

    function focused(): DecisionRow | null {
      const idx = focusedIndex();
      return idx === -1 ? null : decisions[idx];
    }

    async function approveAction() {
      const d = focused();
      if (!d) return;
      try {
        await api.approve(d.cockpitDecisionId, 'me');
        qc.invalidateQueries({ queryKey: ['decisions'] });
      } catch {
        /* surfaced by the queue's mutation error boundary later */
      }
    }

    function startRedirectOnFocused() {
      const d = focused();
      if (!d) return;
      // startRedirect selects the session and sets redirectingDecisionId.
      // SessionDetail's mode-effect picks that up and focuses the textarea.
      startRedirect(d.cockpitDecisionId, d.cockpitSessionId);
    }

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // ? overlay toggles regardless of focus.
      if (e.key === '?') {
        e.preventDefault();
        setKeymapOpen(!keymapOpen);
        return;
      }
      // Esc cascades: keymap → spawn modal → detail panel → focus
      if (e.key === 'Escape') {
        if (keymapOpen) {
          setKeymapOpen(false);
          return;
        }
        if (spawnModalOpen) {
          setSpawnModal(false);
          return;
        }
        if (selectedSessionId) {
          setSelected(null);
          return;
        }
        if (focusedDecisionId) setFocusedDecision(null);
        return;
      }
      // n / N opens spawn modal.
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setSpawnModal(true);
        return;
      }
      // Shift+J / Shift+K cycle through live agents on the canvas
      // (regardless of whether they have an open decision). e.key
      // returns the SHIFTED character — so 'J' / 'K'.
      if (e.key === 'J' || e.key === 'K') {
        e.preventDefault();
        moveSession(e.key === 'J' ? 1 : -1);
        return;
      }
      // j / k navigate the queue.
      if (e.key === 'j') {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        move(-1);
        return;
      }
      // Enter / a → approve.
      if (e.key === 'Enter' || e.key === 'a') {
        e.preventDefault();
        void approveAction();
        return;
      }
      // i → start redirect (opens detail + auto-focuses textarea).
      if (e.key === 'i') {
        e.preventDefault();
        startRedirectOnFocused();
        return;
      }
      // l → step rightward into the detail panel. If the panel isn't
      // open, opening it first; either way the textarea takes focus
      // (sessiondetail listens for cockpit:focus-detail).
      if (e.key === 'l') {
        e.preventDefault();
        const d = focused();
        const targetId = selectedSessionId ?? d?.cockpitSessionId ?? null;
        if (!targetId) return;
        if (selectedSessionId !== targetId) setSelected(targetId);
        // Defer the focus event a frame so SessionDetail has mounted /
        // its textarea ref is alive when we dispatch.
        requestAnimationFrame(() =>
          window.dispatchEvent(new CustomEvent('cockpit:focus-detail')),
        );
        return;
      }
      // h → step leftward back to the queue. Closes the detail panel
      // but keeps focusedDecisionId so j/k still work.
      if (e.key === 'h') {
        if (!selectedSessionId) return;
        e.preventDefault();
        setSelected(null);
        return;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    decisions,
    sessions,
    focusedDecisionId,
    setFocusedDecision,
    setSelected,
    setSpawnModal,
    setKeymapOpen,
    spawnModalOpen,
    selectedSessionId,
    keymapOpen,
    startRedirect,
    qc,
  ]);
}
