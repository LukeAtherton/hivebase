import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface CockpitState {
  selectedSessionId: string | null;
  hoveredSessionId: string | null;
  // Focused decision id for keyboard nav (j/k cycles through it).
  focusedDecisionId: string | null;
  // Spawn modal visibility — owned here so the global keymap can open it.
  spawnModalOpen: boolean;
  // Keymap overlay visibility (?).
  keymapOpen: boolean;
  toasts: Toast[];
  // Rolling timestamps of recent live events (for the events/min sparkline).
  // Trimmed to last 5 minutes on every push.
  recentEventTimes: number[];
  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setFocusedDecision: (id: string | null) => void;
  setSpawnModal: (open: boolean) => void;
  setKeymapOpen: (open: boolean) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  recordEvent: () => void;
}

let toastSeq = 0;

export const useCockpitStore = create<CockpitState>((set) => ({
  selectedSessionId: null,
  hoveredSessionId: null,
  focusedDecisionId: null,
  spawnModalOpen: false,
  keymapOpen: false,
  toasts: [],
  recentEventTimes: [],
  setSelected: (id) => set({ selectedSessionId: id }),
  setHovered: (id) => set({ hoveredSessionId: id }),
  setFocusedDecision: (id) => set({ focusedDecisionId: id }),
  setSpawnModal: (open) => set({ spawnModalOpen: open }),
  setKeymapOpen: (open) => set({ keymapOpen: open }),
  pushToast: (toast) => set((s) => ({ toasts: [...s.toasts, { ...toast, id: ++toastSeq }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  recordEvent: () =>
    set((s) => {
      const now = Date.now();
      const cutoff = now - 5 * 60 * 1000;
      const next = s.recentEventTimes.filter((t) => t > cutoff);
      next.push(now);
      return { recentEventTimes: next };
    }),
}));
