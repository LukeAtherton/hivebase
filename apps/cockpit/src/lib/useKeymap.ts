import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type DecisionRow } from './api';
import { useCockpitStore } from '../store/cockpitStore';

// Single global keymap. Lives on the App so all routes share it.
//
// Bindings (when not typing in an input/textarea):
//   j / k             cycle focus through visible decisions
//   a / b / r         approve / block / reply (focused decision)
//   Enter             select the focused decision's session (opens detail)
//   Esc               close detail / close spawn modal / clear focus
//   n                 open spawn modal
//   ?                 toggle keymap overlay
//
// Reply (r) opens the card's textarea via a custom event the card listens to;
// keeps the keymap pure-state and the card owns its UI.
export function useKeymap(decisions: DecisionRow[]) {
  const qc = useQueryClient();
  const focusedDecisionId = useCockpitStore((s) => s.focusedDecisionId);
  const setFocusedDecision = useCockpitStore((s) => s.setFocusedDecision);
  const setSelected = useCockpitStore((s) => s.setSelected);
  const setSpawnModal = useCockpitStore((s) => s.setSpawnModal);
  const setKeymapOpen = useCockpitStore((s) => s.setKeymapOpen);
  const spawnModalOpen = useCockpitStore((s) => s.spawnModalOpen);
  const selectedSessionId = useCockpitStore((s) => s.selectedSessionId);
  const keymapOpen = useCockpitStore((s) => s.keymapOpen);

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

    function focused(): DecisionRow | null {
      const idx = focusedIndex();
      return idx === -1 ? null : decisions[idx];
    }

    async function act(action: 'approve' | 'block') {
      const d = focused();
      if (!d) return;
      try {
        if (action === 'approve') await api.approve(d.cockpitDecisionId, 'me');
        else await api.block(d.cockpitDecisionId, 'me');
        qc.invalidateQueries({ queryKey: ['decisions'] });
      } catch {
        /* surfaced by the queue's mutation error boundary later */
      }
    }

    function openReplyOnFocused() {
      const d = focused();
      if (!d) return;
      // Fire a CustomEvent the card listens to so reply UX stays card-local.
      window.dispatchEvent(
        new CustomEvent('cockpit:open-reply', {
          detail: { decisionId: d.cockpitDecisionId },
        }),
      );
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
      // a / b / r act on focused.
      if (e.key === 'a') {
        e.preventDefault();
        void act('approve');
        return;
      }
      if (e.key === 'b') {
        e.preventDefault();
        void act('block');
        return;
      }
      if (e.key === 'r') {
        e.preventDefault();
        openReplyOnFocused();
        return;
      }
      // Enter selects the focused decision's session.
      if (e.key === 'Enter') {
        const d = focused();
        if (d) setSelected(d.cockpitSessionId);
        return;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    decisions,
    focusedDecisionId,
    setFocusedDecision,
    setSelected,
    setSpawnModal,
    setKeymapOpen,
    spawnModalOpen,
    selectedSessionId,
    keymapOpen,
    qc,
  ]);
}
