import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface CockpitState {
  selectedSessionId: string | null;
  hoveredSessionId: string | null;
  // Hovered territory id for showing the "+ agent" affordance on the canvas.
  hoveredTerritoryId: string | null;
  // Focused decision id for keyboard nav (j/k cycles through it).
  focusedDecisionId: string | null;
  // Decision currently being redirected. When set, SessionDetail's reply
  // input switches into redirect mode (severity-tinted, "SEND REDIRECT"
  // button, submits to api.reply rather than sendSessionMessage). Cleared
  // by ✕ in the band, by Esc, or by selecting another redirect.
  redirectingDecisionId: string | null;
  // Tile detail: when an operator clicks a claimed terrain tile we open
  // a floating panel showing that file's cumulative diff + PR status.
  // Cleared by ✕, Esc, or selecting another tile.
  selectedTile: { cockpitSessionId: string; filePath: string } | null;
  // Spawn modal visibility — owned here so the global keymap can open it.
  spawnModalOpen: boolean;
  // Optional preset hint for the spawn modal:
  //   { projectId } → preselect this project's "spawn into existing" mode
  //   { mode: 'new' } → open straight into the new-project sub-form
  // Cleared on close. Driven by hex-click affordances on the canvas
  // (click-empty-cell-inside-island vs click-empty-canvas).
  spawnModalPreset: { projectId?: string; mode?: 'new' } | null;
  // Scoping surface visibility — opt-in alongside SpawnModal during step 3.
  // SpawnModal cuts over to this in step 4 once the scoping surface proves itself.
  scopingSurfaceOpen: boolean;
  // When opening ScopingSurface from a territory click, this carries the
  // preselected project so the surface skips its picker step.
  scopingTargetProjectId: string | null;
  // Keymap overlay visibility (?).
  keymapOpen: boolean;
  toasts: Toast[];
  // Rolling timestamps of recent live events (for the events/min sparkline).
  // Trimmed to last 5 minutes on every push.
  recentEventTimes: number[];
  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setHoveredTerritory: (id: string | null) => void;
  setFocusedDecision: (id: string | null) => void;
  // Open redirect mode for the given decision targeted at the given
  // session. Replace-with-toast semantics: if a redirect is already in
  // progress for a different decision, we drop the draft and warn.
  startRedirect: (decisionId: string, sessionId: string) => void;
  cancelRedirect: () => void;
  setSelectedTile: (tile: { cockpitSessionId: string; filePath: string } | null) => void;
  // Open the unified spawn modal. Optional preset hints which project
  // (or "new project" mode) it should land on.
  openSpawnModal: (preset?: { projectId?: string; mode?: 'new' }) => void;
  setSpawnModal: (open: boolean) => void;
  openScopingForProject: (projectId: string) => void;
  setScopingSurface: (open: boolean) => void;
  setKeymapOpen: (open: boolean) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  recordEvent: () => void;
}

let toastSeq = 0;

export const useCockpitStore = create<CockpitState>((set) => ({
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
  setSelected: (id) => set({ selectedSessionId: id }),
  setHovered: (id) => set({ hoveredSessionId: id }),
  setHoveredTerritory: (id) => set({ hoveredTerritoryId: id }),
  setFocusedDecision: (id) => set({ focusedDecisionId: id }),
  startRedirect: (decisionId, sessionId) =>
    set((s) => {
      const replacing = s.redirectingDecisionId && s.redirectingDecisionId !== decisionId;
      const toasts = replacing
        ? [
            ...s.toasts,
            {
              id: ++toastSeq,
              kind: 'info' as const,
              text: 'switched to a new redirect — previous draft discarded',
            },
          ]
        : s.toasts;
      return {
        redirectingDecisionId: decisionId,
        selectedSessionId: sessionId,
        focusedDecisionId: decisionId,
        toasts,
      };
    }),
  cancelRedirect: () => set({ redirectingDecisionId: null }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  openSpawnModal: (preset) =>
    set({ spawnModalOpen: true, spawnModalPreset: preset ?? null }),
  setSpawnModal: (open) =>
    set(open ? { spawnModalOpen: true } : { spawnModalOpen: false, spawnModalPreset: null }),
  openScopingForProject: (projectId) =>
    set({ scopingSurfaceOpen: true, scopingTargetProjectId: projectId }),
  setScopingSurface: (open) =>
    set(open ? { scopingSurfaceOpen: true } : { scopingSurfaceOpen: false, scopingTargetProjectId: null }),
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
