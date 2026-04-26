// Workflows = ordered sequences of node ids that read as a coherent
// user story. The audit page renders each workflow as a section, with
// each step showing the state's snapshot + annotations + critique.
//
// A node can appear in multiple workflows (e.g. impl-healthy is the
// neutral starting point for several paths). Rendering the same state
// in multiple contexts is the point — different workflows tell
// different things about the same UI surface.

export interface WorkflowDefinition {
  id: string;
  title: string;
  // One-line description shown under the workflow title.
  premise: string;
  // Ordered node ids. Each node gets a step card.
  steps: string[];
  // Which bottleneck this workflow most directly stresses.
  // Used as a chip on the workflow heading and in the sidebar.
  bottleneck: '#1 spawn' | '#2 peripheral' | '#3 approval-tax' | '#4 decision-context' | 'baseline';
}

export const workflows: WorkflowDefinition[] = [
  {
    id: 'happy-path',
    title: 'Happy path — spawn to verification',
    premise:
      "The simplest sequence: operator spawns a fresh agent, the agent works without surfacing decisions, and arrives at ready-for-review. The states the cockpit handles WELL plus the one it doesn't handle at all.",
    steps: ['fleet-overview', 'scope-spawn-today', 'impl-healthy', 'verify-ready'],
    bottleneck: 'baseline',
  },
  {
    id: 'scoping-redesign',
    title: 'Scoping (proposed)',
    premise:
      "What the spawn flow could look like if the cockpit modelled scoping as a stage: chat + crystallising scope artifact, then a fresh implementation agent on agree. Compare with the spawn-modal-as-textarea step in the happy path.",
    steps: ['fleet-overview', 'scope-surface', 'impl-healthy'],
    bottleneck: '#1 spawn',
  },
  {
    id: 'advisory-cooldown',
    title: 'Advisory cooldown — the no-context decision',
    premise:
      "The bottleneck-4 case the operator named explicitly: \"npm build failed — no context for me to make a decision on that.\" Card today says little; operator must click into SessionDetail to know what to do.",
    steps: ['impl-healthy', 'impl-advisory-cooldown', 'impl-recently-resolved'],
    bottleneck: '#4 decision-context',
  },
  {
    id: 'destructive-gate',
    title: 'Destructive action — required gate',
    premise:
      "Master caution red, no auto-expire, default = block. A real judgment call. But the card today still doesn't show the affected paths or agent rationale on the card itself.",
    steps: ['impl-healthy', 'impl-required-destructive', 'impl-recently-resolved'],
    bottleneck: '#4 decision-context',
  },
  {
    id: 'security-policy',
    title: 'Security path — same UI, different decision',
    premise:
      'A write to .env.example fires the SAME card UI as a recursive delete — but they\'re very different decisions. This is where per-capability autonomy (Sheridan) would route them differently rather than treating them uniformly required.',
    steps: ['impl-healthy', 'impl-required-security', 'impl-recently-resolved'],
    bottleneck: '#3 approval-tax',
  },
  {
    id: 'stale-decision',
    title: 'Stale waiting — operator missed the master caution',
    premise:
      'Required decision, 38 minutes old. No escalation, no audio, no OS notification, no operator-away detection. Bottleneck 2 made empirically visible.',
    steps: ['impl-healthy', 'impl-stale', 'cc-audio', 'cc-recap'],
    bottleneck: '#2 peripheral',
  },
  {
    id: 'context-pressure',
    title: 'Context pressure — silent quality cliff',
    premise:
      'Long-running migration approaching context-window limit. Tile pressure-height encodes this; nothing else does. Endsley Projection layer entirely missing — should forecast "limit in N minutes."',
    steps: ['impl-healthy', 'impl-context-pressure', 'verify-ready'],
    bottleneck: '#2 peripheral',
  },
  {
    id: 'verification-gap',
    title: 'Verification — the cockpit goes silent',
    premise:
      "Agent claims done. Today the cockpit has no surface for this — operator falls back to their editor. The proposed verification surface is side-by-side scope ↔ delivered diff ↔ test results. This is the moment more of the day leaks out of the cockpit.",
    steps: ['impl-recently-resolved', 'verify-ready', 'verify-surface', 'post-pr-ci'],
    bottleneck: '#3 approval-tax',
  },
];

// Cross-cutting nodes called out in the sidebar for context.
export const crossCuttingNodeIds = ['cc-summary', 'cc-audio', 'cc-recap'];
