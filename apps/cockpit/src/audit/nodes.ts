// Audit-canvas data model.
//
// One node per view-state. Nodes are positioned manually so the layout
// reads left-to-right by stage (scoping → implementation → verification),
// with cross-cutting infrastructure on a top strip and missing-but-
// proposed views called out distinctly.
//
// Edges are workflow transitions: how the operator (or the system) moves
// between view-states. Solid = real transition today; dashed = proposed
// transition that needs new UI to support.

export type Stage = 'scoping' | 'implementation' | 'verification' | 'cross-cutting' | 'fleet';
export type Severity = 'calm' | 'amber' | 'red' | 'neutral';

// Highlight = a labelled rectangle drawn on top of the snapshot.
// `selector` resolves to a DOM element in the cockpit at capture time;
// the snapshot script writes the bounding box to the per-node JSON.
// `label` is shown on the canvas as a callout.
export interface AuditHighlight {
  selector: string;
  label: string;
  // Optional: which side of the rect the callout label sits on.
  callout?: 'top' | 'bottom' | 'left' | 'right';
}

export interface AuditNodeData {
  id: string;
  title: string;
  stage: Stage;
  severity: Severity;
  summary: string; // shown on the card
  description: string; // shown in the side panel
  uiToday?: string;
  uiGap?: string;
  bottlenecks: string[]; // short tags shown on card and panel
  foundations?: string[];
  seedSessionIx?: number; // pointer to seed-mock-states.ts session ix
  highlights?: AuditHighlight[]; // overlays drawn on the captured snapshot
}

export interface AuditNodeSpec extends AuditNodeData {
  position: { x: number; y: number };
}

export interface AuditEdgeSpec {
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  dashed?: boolean; // dashed = proposed transition needing new UI
}

// X positions: 0=fleet entry, 360=scoping, 720=impl, 1080=verification, 1440=post.
// Y positions: -160=cross-cutting strip, 0..520=stage rows from calm to red.
const X = { fleet: 0, scoping: 360, impl: 720, verify: 1080, post: 1440 };
const Y = { cross: -160, calm: 40, advisory: 200, required: 380, stale: 540, stopped: 700 };

export const auditNodes: AuditNodeSpec[] = [
  // --- Fleet entry ---
  {
    id: 'fleet-overview',
    title: 'Portfolio map (overview)',
    stage: 'fleet',
    severity: 'neutral',
    summary: 'Operator opens the cockpit. Spatial overview of all live agents.',
    description:
      'The first thing the operator sees on focus. Multi-channel tile encoding (state colour, pressure-height, heartbeat) gives glanceable fleet health. From here they orient: which projects, who is busy, who needs me?',
    uiToday: 'PortfolioMap.tsx — six channels of tile state, drift orbit, master caution at the top.',
    uiGap: 'No filter (Shneiderman zoom-and-filter unbuilt). No stage badge on tile (a scoping agent looks identical to an implementation agent). Hover preview is selected-tile-only.',
    bottlenecks: ['#2 peripheral'],
    foundations: ['Endsley Perception (strong)', 'Shneiderman overview (strong)', 'Pirolli scent (weak)'],
    highlights: [
      { selector: '[data-audit-id="portfolio-map"]', label: 'fleet map', callout: 'top' },
      { selector: '[data-audit-id="spawn-button"]', label: '+ spawn (scoping entry)', callout: 'right' },
    ],
    position: { x: X.fleet, y: Y.calm },
  },

  // --- Cross-cutting infrastructure (top strip) ---
  {
    id: 'cc-summary',
    title: 'Summary line',
    stage: 'cross-cutting',
    severity: 'neutral',
    summary: 'Always-visible glanceable annunciator.',
    description:
      'One row at the top: master caution colour, decision counts, oldest age, fleet status. Stage-agnostic. The vision\'s "7 decisions, oldest 4h, fleet ok" line.',
    uiToday: 'SummaryLine.tsx — required/advisory split, sparkline, agent count.',
    uiGap: 'No stage breakdown ("3 in scoping, 7 in impl"). No decisions-resolved-today counter. No median-decision-queue-age.',
    bottlenecks: ['#2 peripheral', '#3 approval-tax'],
    highlights: [
      { selector: '[data-audit-id="summary-line"]', label: 'always-visible ribbon', callout: 'bottom' },
    ],
    position: { x: X.fleet + 200, y: Y.cross },
  },
  {
    id: 'cc-audio',
    title: 'Audio + OS notification (missing)',
    stage: 'cross-cutting',
    severity: 'amber',
    summary: 'Out-of-window peripheral channel. NOT YET BUILT.',
    description:
      'When the cockpit window is unfocused, required-severity decisions need a peripheral signal that does not require focus. Audio cue + OS notification + menubar badge. The bottleneck-2 fix that no in-window UI can solve.',
    uiToday: 'Nothing. Window must have focus for the operator to see anything.',
    uiGap: 'Entirely missing. Highest-leverage cross-cutting addition for bottleneck 2.',
    bottlenecks: ['#2 peripheral'],
    foundations: ['Weiser & Brown calm tech (audio is the missing channel)'],
    position: { x: X.fleet + 600, y: Y.cross },
  },
  {
    id: 'cc-recap',
    title: 'Away/recap surface (missing)',
    stage: 'cross-cutting',
    severity: 'neutral',
    summary: 'On return from away, recap what happened. NOT YET BUILT.',
    description:
      "Mark's resumption-cost mitigation. When operator returns after being away (idle / window unfocused), present a recap: 3 decisions auto-resolved, 1 still open, 2 agents reached verification. Single dismiss returns to live view.",
    uiToday: 'Nothing. The operator returns and has to scan everything from scratch.',
    uiGap: 'Entirely missing.',
    bottlenecks: ['#2 peripheral'],
    foundations: ['Mark resumption cost', 'Weiser & Brown calm tech'],
    position: { x: X.fleet + 1000, y: Y.cross },
  },

  // --- Scoping stage ---
  {
    id: 'scope-spawn-today',
    title: 'Spawn modal (today)',
    stage: 'scoping',
    severity: 'amber',
    summary: 'A textarea pretending to be the entire scoping stage.',
    description:
      'The operator clicks "+ spawn", picks a project, types a freeform brief, presses launch. The agent receives the brief and starts implementing immediately. There is no exploration, no artifact, no agent participation in the scoping conversation.',
    uiToday: 'SpawnModal.tsx — project picker + freeform textarea + optional callsign + branch.',
    uiGap: 'This is bottleneck #1 made visible. The whole scoping stage is compressed into one paragraph the operator drafts alone. KILL in v2.',
    bottlenecks: ['#1 spawn-friction'],
    foundations: ['Sheridan (no autonomy preset)', 'Endsley Comprehension (no shared mental model)'],
    highlights: [
      { selector: '[data-audit-id="spawn-button"]', label: 'one button — opens a textarea modal', callout: 'right' },
    ],
    position: { x: X.scoping, y: Y.advisory },
  },
  {
    id: 'scope-surface',
    title: 'Scoping surface (proposed)',
    stage: 'scoping',
    severity: 'calm',
    summary: 'Chat + crystallising scope artifact. Replaces SpawnModal.',
    description:
      'Two-pane view: conversation on the left (live chat with a read-only agent), scope artifact on the right (task statement, acceptance criteria, non-goals, touch surface, autonomy preset). The artifact fills in mid-conversation; the agent drafts, the operator edits. "Agree" transitions to implementation by spawning a fresh agent with the artifact as its only context.',
    uiToday: 'NOT BUILT.',
    uiGap: 'The bottleneck-1 fix. See `view-inventory.md` for full information hierarchy.',
    bottlenecks: ['#1 spawn-friction'],
    foundations: ['Sheridan (autonomy preset attached)', 'Endsley Comprehension (shared artifact)', 'Pirolli scent (file citations inline)'],
    seedSessionIx: 5,
    position: { x: X.scoping, y: Y.calm },
  },

  // --- Implementation stage — calm ---
  {
    id: 'impl-healthy',
    title: 'Implementation: healthy',
    stage: 'implementation',
    severity: 'calm',
    summary: 'Agent working productively. No decisions open. Tile dim and calm.',
    description:
      'The dark-cockpit ideal. Agent is making progress (todos updating, file edits flowing) but has not surfaced any gating decision. Operator has nothing to do. Master caution off.',
    uiToday: 'PortfolioMap tile pulses gently with activity. SessionDetail (if selected) shows live transcript stream and current todos.',
    uiGap: 'None for this state — this is exactly what the dark-cockpit philosophy targets.',
    bottlenecks: [],
    foundations: ['Weiser & Brown calm tech (dark cockpit)'],
    highlights: [
      { selector: '[data-audit-id="portfolio-map"]', label: 'tile dim and pulsing — healthy', callout: 'top' },
      { selector: '[data-audit-session-id="ckse_seed_01_____________"]', label: 'outliner row — implementing', callout: 'left' },
    ],
    seedSessionIx: 1,
    position: { x: X.impl, y: Y.calm },
  },
  {
    id: 'impl-recently-resolved',
    title: 'Implementation: recently resolved',
    stage: 'implementation',
    severity: 'calm',
    summary: 'Decision was approved 2 minutes ago. Agent continuing.',
    description:
      'Closed decision sits in the ledger but the queue has cleared. Tile back to calm. Useful state for the audit because it shows what "after" looks like — does the operator have any signal that the resolution worked?',
    uiToday: 'Decision card no longer in queue. SessionDetail timeline shows the resolution event. No explicit "you just approved this" reinforcement.',
    uiGap: 'No closure feedback. The operator clicks approve, the card vanishes, and it is unclear whether the agent actually resumed. (Especially relevant for cross-process gating.)',
    bottlenecks: ['#4 decision-context'],
    foundations: ['Lee & See trust (no closure → no calibration)'],
    highlights: [
      { selector: '[data-audit-id="decision-queue"]', label: 'queue cleared — no closure feedback', callout: 'top' },
      { selector: '[data-audit-id="session-detail"]', label: 'timeline shows resolution event but no "you just approved" reinforcement', callout: 'left' },
    ],
    seedSessionIx: 10,
    position: { x: X.impl + 200, y: Y.calm },
  },

  // --- Implementation stage — advisory ---
  {
    id: 'impl-advisory-cooldown',
    title: 'Implementation: advisory cooldown',
    stage: 'implementation',
    severity: 'amber',
    summary: 'pnpm test failed. Cooldown bar draining. Default = approve.',
    description:
      "Classic case of bottleneck #4 in the operator's own words: 'npm build failed — no context for me to make a decision on that, not even sure what I'm being asked.' Card today shows just the failure. Operator has to click into SessionDetail to see what was running and what the stderr was.",
    uiToday: 'DecisionQueue card with one-line question + cooldown bar. SessionDetail decision-context block has the evidence (good) but you have to navigate to it (bad).',
    uiGap: 'Card needs to pull the evidence forward (last 3 lines of stderr inline), name what the agent was attempting, and offer structured reject options ("retry with X", "change approach"). This is decision card v2.',
    bottlenecks: ['#3 approval-tax', '#4 decision-context'],
    foundations: ['Pirolli scent (weak — evidence behind a click)', 'Horvitz cost-of-interruption (not modelled)'],
    highlights: [
      { selector: '[data-audit-id="decision-cards"]', label: 'card today: terse question, evidence behind a click', callout: 'top' },
      { selector: '[data-audit-id="annunciator"]', label: 'amber annunciator strip', callout: 'left' },
    ],
    seedSessionIx: 2,
    position: { x: X.impl, y: Y.advisory },
  },

  // --- Implementation stage — required ---
  {
    id: 'impl-required-destructive',
    title: 'Implementation: required (destructive)',
    stage: 'implementation',
    severity: 'red',
    summary: 'rm -rf gated. Master caution RED. No expiry.',
    description:
      'A real judgment call — the agent wants to recursively delete tmp/ subdirs. Required severity, no auto-expire, default = block. Master caution glow + annunciator + queue card all light up.',
    uiToday: 'Queue card with "Approve recursive delete?", master caution pulse, annunciator label.',
    uiGap: 'Card does not show the affected paths or the agent\'s rationale (which is in payload but not surfaced). Operator has to click in to know what would actually be deleted.',
    bottlenecks: ['#4 decision-context'],
    foundations: ['Sheridan (this IS a real ask — but no per-agent autonomy means everything routes through one classifier)', 'Endsley Comprehension (need the affected files visible)'],
    highlights: [
      { selector: '[data-audit-id="annunciator"]', label: 'master caution RED — required severity', callout: 'bottom' },
      { selector: '[data-audit-id="decision-cards"]', label: 'rm -rf card, no expiry, default block', callout: 'top' },
    ],
    seedSessionIx: 3,
    position: { x: X.impl, y: Y.required },
  },
  {
    id: 'impl-required-security',
    title: 'Implementation: required (security)',
    stage: 'implementation',
    severity: 'red',
    summary: 'Write to .env.example flagged. Sensitive path.',
    description:
      'Agent intends to remove deprecated env vars and add a new one. Sensitive-path classifier fires required + block default. Same UI shape as destructive — but a very different decision (this is almost certainly fine; destructive could go badly).',
    uiToday: 'Same card shape as the destructive case. No policy distinction.',
    uiGap: 'Per-capability autonomy would let .env edits route differently from rm -rf. Today they are uniformly "required". The classifier is uniform; reality is not.',
    bottlenecks: ['#3 approval-tax', '#4 decision-context'],
    foundations: ['Sheridan (per-capability autonomy missing)'],
    highlights: [
      { selector: '[data-audit-id="annunciator"]', label: 'identical RED treatment to rm -rf', callout: 'bottom' },
      { selector: '[data-audit-id="decision-cards"]', label: '.env edit — same UI shape as recursive delete', callout: 'top' },
    ],
    seedSessionIx: 4,
    position: { x: X.impl + 200, y: Y.required },
  },

  // --- Implementation stage — stale ---
  {
    id: 'impl-stale',
    title: 'Implementation: stale waiting',
    stage: 'implementation',
    severity: 'red',
    summary: 'Decision open >38 minutes. Operator has not noticed.',
    description:
      'A required scope-ambiguity decision that has been waiting for 38 minutes. The agent emitted a Notification ("which strategy?") and is paused. The operator has either been away, focused elsewhere, or did not see the master caution. No differential salience kicks in — the cockpit treats this no differently from a 30-second-old decision.',
    uiToday: 'Card sits in queue, oldest first. Master caution still on (because it is required). No escalation, no audio, no OS notification, no "this has been waiting absurdly long" highlight.',
    uiGap: 'Bottleneck 2 made visible. Need (a) audio + OS notification on creation, (b) escalation if still open after N minutes, (c) "operator has been away" detection + recap on return.',
    bottlenecks: ['#2 peripheral'],
    foundations: ['Mark interruption science (no escalation)', 'Weiser & Brown (no audio = peripheral channel missing)'],
    highlights: [
      { selector: '[data-audit-id="decision-cards"]', label: '38min old card — no escalation, no differential salience', callout: 'top' },
    ],
    seedSessionIx: 7,
    position: { x: X.impl, y: Y.stale },
  },
  {
    id: 'impl-context-pressure',
    title: 'Implementation: high context pressure',
    stage: 'implementation',
    severity: 'amber',
    summary: 'Agent at ~85% of context window. Quality risk approaching.',
    description:
      'Long-running migration session. Cumulative input tokens approaching the context window limit. Tile pressure-height encoding shows this; nothing else does. Worth surfacing because hitting context limits silently is a quality cliff.',
    uiToday: 'Pressure-height channel on the tile. SessionDetail shows token count. No projection ("will hit limit in N min").',
    uiGap: 'Endsley Projection layer entirely missing. Should forecast: "agent 8 will hit context limit in ~6 min at current velocity." Could trigger pre-emptive scope hand-back to a fresh agent.',
    bottlenecks: ['#2 peripheral'],
    foundations: ['Endsley Projection (entirely missing)'],
    highlights: [
      { selector: '[data-audit-id="portfolio-map"]', label: 'tile pressure-height encodes context fill — only signal', callout: 'top' },
      { selector: '[data-audit-session-id="ckse_seed_08_____________"]', label: 'outliner row — no projection ("limit in N min")', callout: 'left' },
    ],
    seedSessionIx: 8,
    position: { x: X.impl + 200, y: Y.stale },
  },
  {
    id: 'impl-stopped',
    title: 'Implementation: stopped',
    stage: 'implementation',
    severity: 'neutral',
    summary: 'Operator halted earlier. Session frozen.',
    description:
      'Terminal state. Useful here because it forces the question: what happens to the worktree? (Today: it sticks around, accumulating disk per the known-rough.) And the ledger entry — what does it record about WHY this was stopped?',
    uiToday: 'Tile drops out of live colour palette. Listed in outliner. Worktree NOT cleaned up.',
    uiGap: 'Worktree cleanup is manual. No reason captured for the stop.',
    bottlenecks: [],
    highlights: [
      { selector: '[data-audit-session-id="ckse_seed_09_____________"]', label: 'outliner row — stopped state, worktree NOT cleaned up', callout: 'left' },
    ],
    seedSessionIx: 9,
    position: { x: X.impl, y: Y.stopped },
  },

  // --- Verification stage ---
  {
    id: 'verify-ready',
    title: 'Verification: ready (today)',
    stage: 'verification',
    severity: 'calm',
    summary: 'Agent claims done. Today: nothing structured to do here.',
    description:
      'Agent has finished implementation, todos all completed, claims tests are green. State machine moves to ready-for-review. The cockpit goes silent — there is no verification surface. Operator falls back to their editor to review the diff and decide whether to merge.',
    uiToday: 'Tile shows "ready-for-review" state colour. SessionDetail timeline ends with the agent\'s done-claim. NO diff view, no test-result aggregation, no scope-vs-delivered comparison.',
    uiGap: 'Whole stage is missing UI. This is the moment more of the day leaks out of the cockpit and into the operator\'s editor / terminal.',
    bottlenecks: ['#3 approval-tax (operator rubber-stamps blind)'],
    foundations: ['Endsley Comprehension (no scope-vs-delivered)', 'Lee & See trust (no track record per agent)'],
    highlights: [
      { selector: '[data-audit-session-id="ckse_seed_06_____________"]', label: 'outliner row — ready-for-review, but no diff/test view exists', callout: 'left' },
      { selector: '[data-audit-id="session-detail"]', label: 'timeline ends with done-claim. No diff. No test results. No verbs.', callout: 'right' },
    ],
    seedSessionIx: 6,
    position: { x: X.verify, y: Y.calm },
  },
  {
    id: 'verify-surface',
    title: 'Verification surface (proposed)',
    stage: 'verification',
    severity: 'calm',
    summary: 'Side-by-side scope ↔ delivered diff ↔ test results.',
    description:
      'Full-window or large panel. Left: agreed scope (read-only). Right: delivered diff + test results + agent\'s done-claim narrative. Verbs: accept / send-back / abandon. Cross-model verifier (e.g. Codex) could pre-screen — see future-work-research.md.',
    uiToday: 'NOT BUILT.',
    uiGap: 'Pulls verification work into the cockpit instead of the editor. Necessary precondition for measuring whether the cockpit pays off across the full agent lifecycle.',
    bottlenecks: ['#3 approval-tax', '#4 decision-context'],
    foundations: ['Endsley Comprehension', 'Lee & See trust', 'Pirolli scent'],
    position: { x: X.verify, y: Y.advisory },
  },

  // --- Post stages (deferred) ---
  {
    id: 'post-pr-ci',
    title: 'PR / CI / review (deferred)',
    stage: 'verification',
    severity: 'neutral',
    summary: 'Out of audit scope. Documented for completeness.',
    description:
      "Future stage: agent opens PR, CI runs, human (or another agent) reviews. The cockpit will eventually need a surface here too. Per the matrix, deferred until the three earlier stages have UI.",
    uiToday: 'Nothing. Operator handles in their browser/IDE.',
    uiGap: 'Whole stage. Not a bottleneck on the critical path right now.',
    bottlenecks: [],
    position: { x: X.post, y: Y.calm },
  },
];

export const auditEdges: AuditEdgeSpec[] = [
  // Operator entering the cockpit
  { source: 'fleet-overview', target: 'cc-summary', label: 'always visible', dashed: false },
  { source: 'fleet-overview', target: 'scope-spawn-today', label: '"+ spawn" today', dashed: false },
  { source: 'fleet-overview', target: 'scope-surface', label: 'proposed entry', dashed: true },

  // Spawn modal → straight into implementation (the bottleneck)
  { source: 'scope-spawn-today', target: 'impl-healthy', label: 'launch (no agreement)', dashed: false },

  // Scoping surface → fresh impl agent
  { source: 'scope-surface', target: 'impl-healthy', label: 'agree → fresh agent', dashed: true, animated: true },

  // Implementation transitions (within the lane)
  { source: 'impl-healthy', target: 'impl-advisory-cooldown', label: 'test fails' },
  { source: 'impl-advisory-cooldown', target: 'impl-recently-resolved', label: 'cooldown expires / approve' },
  { source: 'impl-healthy', target: 'impl-required-destructive', label: 'destructive cmd' },
  { source: 'impl-healthy', target: 'impl-required-security', label: 'sensitive path' },
  { source: 'impl-required-destructive', target: 'impl-recently-resolved', label: 'approve / block' },
  { source: 'impl-required-security', target: 'impl-recently-resolved', label: 'approve / block' },
  { source: 'impl-required-destructive', target: 'impl-stale', label: 'no response →' },
  { source: 'impl-required-security', target: 'impl-stale', label: 'no response →' },
  { source: 'impl-healthy', target: 'impl-context-pressure', label: 'long run' },
  { source: 'impl-context-pressure', target: 'verify-ready', label: 'finishes despite pressure' },

  // Implementation → verification
  { source: 'impl-recently-resolved', target: 'verify-ready', label: 'todos all done' },
  { source: 'verify-ready', target: 'verify-surface', label: 'proposed', dashed: true },
  { source: 'verify-surface', target: 'post-pr-ci', label: 'accept', dashed: true },
  { source: 'verify-ready', target: 'post-pr-ci', label: 'manual today', dashed: false },

  // Stop is reachable from anywhere
  { source: 'impl-healthy', target: 'impl-stopped', label: 'operator halts' },
  { source: 'impl-stale', target: 'impl-stopped', label: 'gives up' },

  // Cross-cutting connections (audio + recap support stale + away)
  { source: 'cc-audio', target: 'impl-stale', label: 'would prevent', dashed: true },
  { source: 'cc-recap', target: 'fleet-overview', label: 'on return', dashed: true },
];
