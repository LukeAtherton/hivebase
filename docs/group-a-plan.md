# Group A implementation plan

*Drafted 2026-04-26 in the `ux-audit` worktree, after the audit wrap-up.
Group A is the **throughput release** per the critique's ranked
roadmap: scoping surface + per-capability autonomy + decision card v2.
This plan resolves the build order, the data-model + hook-protocol
shape, and the cross-item dependencies.*

---

## TL;DR

The three Group A items have real coupling. The naive
"ship-them-together" plan is risky — too much surface change at once,
and any one of them slipping blocks the rest. The right answer is to
**carve them along their natural dependency lines and ship in
incremental, individually useful slices.**

Build order:

1. **Per-capability autonomy data model + UI shell** (no scoping
   integration yet — gate logic consults a default policy).
2. **Decision card v2** (classifier enrichment + denser card).
3. **Scoping surface** as an opt-in alternative to SpawnModal,
   producing a scope artifact that *includes* an autonomy preset.
4. **Cut over** SpawnModal once the scoping surface is proven.

Each step is independently shippable. Each lights up *some* of the
named bottlenecks immediately. Each leaves the surface in a coherent
state if we pause between steps.

---

## Why not "ship Group A as one big v0.2 release"

The critique calls Group A "the throughput release" with the
implication of a single ship. Re-examining: that framing is right
about the destination, wrong about the path.

Three reasons to slice instead of bundle:

1. **The riskiest piece is scoping surface** — new agent prompt
   shape, new fresh-context handoff, new UI paradigm, multi-turn
   chat in a surface that today has none of those things. Bundling
   it with two other releases means a slip in scoping blocks the
   wins from autonomy + card v2.
2. **Autonomy can demonstrably help bottleneck 3 the day it ships,
   even with default-only presets.** It does not need scoping
   integration to start removing approval-tax — most existing
   sessions can be retrofitted with a sensible preset.
3. **Card v2 helps bottleneck 4 the day it ships, regardless of
   autonomy or scoping.** Same as above — independent value.

Bundling all three means none of them ship until all three are
ready. Slicing means each lands as soon as it's ready and the
operator's day improves incrementally.

---

## Coupling analysis

The three items interact through three points:

| Interaction                       | What couples                       | How to decouple                      |
|-----------------------------------|------------------------------------|--------------------------------------|
| Scoping artifact contains preset  | Scoping surface ↔ autonomy data    | Artifact includes preset *if* autonomy ships first; otherwise the preset slot is greyed-out / forced default |
| Card v2 shows "policy says X"     | Card v2 ↔ autonomy data            | Without autonomy, card v2 is informative without policy mention; with autonomy, it can include "this fires because autonomy=ask" |
| Card v2 reject options reference policies | Card v2 ↔ autonomy presets | Reject options menu uses a fixed canonical list initially; preset-aware refinement comes in a later iteration |

In all three cases, **autonomy first decouples the others.**
Autonomy doesn't need scoping or cards. Scoping and cards both
*benefit* from autonomy but don't require it.

That's the build order.

---

## Step 1 — Per-capability autonomy data model + UI shell

**Goal.** Stand up the policy data model. Default policies. Gate
logic consults policy before classifier. Minimal UI for the operator
to view and override policies on a per-agent basis.

**Schema.**

```sql
-- New table. Per-agent (or per-scope-preset) capability × stage policy.
CREATE TABLE cockpit_autonomy_policies (
  cockpit_autonomy_policy_id text PRIMARY KEY,
  cockpit_agent_id text NULL,     -- NULL = default / template policy
  preset_name text NULL,          -- when this is a named preset, e.g. 'sandboxed'
  capability text NOT NULL,        -- 'edit-files' | 'push-branch' | 'run-tests' | ...
  stage text NOT NULL,             -- 'scoping' | 'implementation' | 'verification'
  level text NOT NULL,             -- 'allow' | 'ask' | 'never'
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (cockpit_agent_id IS NOT NULL OR preset_name IS NOT NULL)
);

CREATE INDEX cockpit_autonomy_agent_idx ON cockpit_autonomy_policies (cockpit_agent_id);
CREATE INDEX cockpit_autonomy_preset_idx ON cockpit_autonomy_policies (preset_name);
```

**Capabilities (initial set).** Ten, per the matrix:
`read-files`, `edit-files`, `run-tests`, `run-build`,
`run-migrations`, `push-branch`, `open-pr`, `merge-pr`,
`network-fetch`, `install-package`, `delete-files`,
`spend-over-threshold`. Plus a catch-all `destructive` for the
classifier-matched destructive patterns.

**Stages.** Three: `scoping`, `implementation`, `verification`.
Stage-aware autonomy is a structural improvement over flat per-
capability — the matrix doc makes the case.

**Default policies (seeded as preset_name='trusted-default').** The
matrix table from `stage-bottleneck-matrix.md` becomes the seed.
Specifically:

```
Capability       scoping  implementation  verification
read-files       allow    allow           allow
edit-files       never    allow           never
run-tests        allow    allow           allow
run-build        allow    allow           allow
push-branch      never    ask             ask
open-pr          never    ask             ask
merge-pr         never    ask             never
run-migrations   never    ask             never
network-fetch    ask      allow           allow
install-package  never    ask             never
destructive      never    ask             never
delete-files     never    ask             never
spend-over-threshold ask  ask             ask
```

**Gate logic change.** In `apps/cockpit-api/src/lib/persistence.ts`
where the classifier output becomes a `cockpit_decisions` row:
*before* writing the decision, look up the agent's policy for the
matched capability + current stage. If `allow`, return verdict to
the hook directly without writing a decision. If `never`, write
the decision pre-resolved with status `blocked` (no human
involvement). If `ask`, current behaviour.

**UI shell (minimal).** Agent detail panel adds a "policy" tab.
Reads policy for that agent, shows the matrix, *does not yet edit*
in this iteration. Read-only is enough to deliver bottleneck-3
relief; edit affordance lands in a follow-up.

**Wins delivered.** Bottleneck 3 (the operator's most-cited):
routine `pnpm test` failures stop reaching the queue for agents on
the trusted-default preset. Approvals-per-hour drops measurably.

**Non-goals for step 1.** Per-scope presets (still default-only).
Edit UI (read-only this round). Audit-log of policy changes
(later). Scope-level overrides (later).

**Falsification.** Decisions per agent-hour drops by ≥30% on
agents using trusted-default. No regression in
accepted-diff-rate (we're not letting bad code through; we're just
not paying the operator's tax to pre-approve routine ops).

**Cost.** Schema migration (small). Gate logic (medium — branches
need real testing). UI shell (small). Total: ~half-day.

---

## Step 2 — Decision card v2

**Goal.** Cards become *self-sufficient* — operator can decide on
the card without clicking through to SessionDetail in the common
case.

**Per the critique:** classifier-enriched questions, inline evidence,
structured reject options.

**Classifier enrichment.** Extend `packages/core/src/triggers.ts`
`ClassifiedTrigger` with:

```ts
interface ClassifiedTrigger {
  triggerType: TriggerType;
  severity: Severity;
  question: string;          // existing — short summary
  detail?: string;           // NEW — 1-2 sentence agent intent
  evidenceLines?: string[];  // NEW — last 3 lines of stderr or similar
  rejectOptions?: RejectOption[]; // NEW — structured templated replies
  toolName?: string;
  command?: string;
  filePath?: string;
}

interface RejectOption {
  id: string;       // 'retry-with-pnpm' | 'skip' | 'change-approach'
  label: string;
  reply: string;    // pre-filled freeform reply text
}
```

For the canonical advisory case (`pnpm test failed`), the classifier
becomes:

```
{
  triggerType: 'failed-validation',
  severity: 'advisory',
  question: 'Test failure — retry, change approach, or block?',
  detail: 'Agent ran `pnpm test src/routes/orders.test.ts`; cursor pagination test expects offset 20 but got 21.',
  evidenceLines: [
    'FAIL  src/routes/orders.test.ts',
    '  ● cursor pagination › decodes cursor',
    '  Expected: { id: "ord_42", offset: 20 } / Received: { id: "ord_42", offset: 21 }',
  ],
  rejectOptions: [
    { id: 'retry', label: 'retry with same approach', reply: 'try again' },
    { id: 'change', label: 'change approach', reply: 'pause — let\'s rethink the cursor encoding' },
  ],
}
```

This is real upgrade — the operator can decide on the card.

**Card UI changes** (in `apps/cockpit/src/components/DecisionQueue.tsx`):

- Add a collapsed-by-default `<details>`-style block showing
  `evidenceLines` (last 3 stderr lines) below the question.
- Add `detail` line under the question (smaller, muted).
- Add a "reject options" dropdown next to the existing buttons that
  expands templated replies as sub-buttons.
- Hover any reject option → shows the pre-filled reply that would be
  sent.

**Integration with autonomy (light).** When a card *would* have been
suppressed by an `allow` policy but wasn't (because the classifier
matched a destructive pattern that always escalates), include a small
chip on the card: *"matched destructive pattern — overriding allow
policy"*. This is the trust-calibration story — the operator can see
*why* this thing reached them.

**Wins delivered.** Bottleneck 4 directly. Time-from-card-appearance
to resolution drops measurably.

**Non-goals for step 2.** Agent competence breadcrumb (Lee & See) —
deferred to the agent-identity work in Group C. "What happens next on
approve" preview — speculative; defer.

**Falsification.** Time-from-card-appearance-to-resolution drops by
≥40% on advisory-cooldown cards specifically. No drop in
reject-rate (cards giving operators *more* context shouldn't change
the rate of reject-vs-approve, just the speed).

**Cost.** Classifier enrichment (medium — needs to read payload
shape per trigger). Card UI (small). Total: ~half-day.

---

## Step 3 — Scoping surface (replaces SpawnModal)

**Goal.** Per `view-inventory.md`: chat + crystallising scope artifact,
fresh-context handoff to a new implementation agent on agree.

**This is the biggest item. Plan it as its own small build, not a
rolled-up sprint.**

**Sub-steps within step 3.**

3a. **Scope artifact data model.** New `cockpit_scope_artifacts`
    table: id, status (draft / agreed / superseded), task statement,
    acceptance criteria (jsonb array), non-goals (jsonb array),
    touch surface (jsonb array), autonomy preset (FK to
    cockpit_autonomy_policies preset), created_at, agreed_at,
    superseded_by.

3b. **Read-only scoping agent spawn.** New API endpoint /scope/start
    that spawns a `claude` CLI child with hooks but autonomy preset
    forcing all editing capabilities to `never`. Agent works on a
    new "scope-only" worktree (read-only-on-source via `git worktree
    --detach`) so it can't accidentally touch files.

3c. **Scoping UI surface.** New right-rail-when-active component
    `ScopingSurface.tsx`: chat pane (live transcript with
    file-citation rendering) + scope artifact pane (editable fields
    matching the data model).

3d. **Artifact extraction from agent text.** Heuristic / prompt-side:
    when the agent emits structured information (lists, file refs),
    extract into the artifact. Initial implementation: regex +
    convention. Later: maybe a structured-output-mode tool call.

3e. **Agree → fresh implementation agent handoff.** When operator
    clicks agree: artifact becomes immutable; scoping agent killed;
    new implementation-stage agent spawned with the artifact
    rendered as initial user message. Per `agent-handoff-decision.md`.

3f. **Cut over SpawnModal** once 3a–3e ship. Until then, scoping
    surface is opt-in alongside SpawnModal — no breakage.

**Wins delivered.** Bottleneck 1 directly. Spawn-time-to-first-
meaningful-edit drops measurably.

**Non-goals for step 3 (deferred to step 4).** Multi-option scoping
question rendering (agent says "A or B?"). Stale-marker on prior
proposals. Artifact version history. Scope-expansion-during-impl
flow. All of these are real per the trace's 11 patterns; ship the
core artifact first.

**Falsification.** Time-to-spawn-first-meaningful-edit drops on
non-trivial tasks. For trivial tasks (one-line edits, doc fixes),
scoping must NOT be slower than SpawnModal — needs a fast-path for
those. Worth designing the fast-path before cutover.

**Cost.** Largest of the three. Schema (medium — new table + FKs).
API (medium — new endpoints, fresh-context handoff). UI (large —
chat + artifact + agree flow). Total: ~2 days conservatively.

---

## Step 4 — Polish + cut over

After 1–3 ship, the scoping artifact carries autonomy presets
naturally; cards reference them in the override-chip text; the
operator can edit policies inline from the agent detail panel
(promoted to writable). SpawnModal removed. v0.2 release tag.

---

## Cross-cutting: schema hygiene as we go

Per `future-work-research.md` §5, we promote frequently-queried JSON
fields into typed columns *as we touch them*, not as a separate
refactor.

In Group A specifically:

- **Step 1 (autonomy):** No payload-extraction work needed.
- **Step 2 (card v2):** `cockpit_events.payload->>'exitCode'` →
  `cockpit_events.exit_code int`. Used by the failed-validation
  classifier. Migration + 5-line backfill.
- **Step 2 (card v2):** `cockpit_events.payload->>'toolName'` →
  `cockpit_events.tool_name text`. Used by the trigger classifier.
- **Step 3 (scoping):** `cockpit_decisions.resolution_latency_ms int`
  derived on resolution write. Becomes the basis of the
  card-time-to-resolve metric the falsification tests need.

These are 5-line migrations each. Done with the relevant step,
not as a separate engineering effort.

---

## What this plan deliberately leaves out

- **Cross-model verification (§1)** — Group B at earliest.
- **Exhaust trail / space elevator (§3)** — speculative reframe;
  not Group A.
- **Auto-research closed loop (§4)** — Group C at earliest. Needs
  per-agent identity which is also Group C.
- **Analytical store (§5)** — not now. Schema hygiene above is the
  preparation.

---

## Last-mile: how we'll know Group A worked

After all four steps land, run the **same canonical scoping
conversation that produced this audit (per
`scoping-trace-canonical.md`)** through the new surface end-to-end.
Score it against the 11 patterns. Specifically:

- Patterns 1, 2, 6, 9, 10 should be cleanly supported.
- Patterns 3 (stale-marker), 7 (scope-restructuring), 8 (artifact
  version history), 11 (scope-expansion-during-impl) are the
  step-4-or-later candidates and are allowed to be partial.

If fewer than 7 of the 11 patterns are cleanly supported, step 3
shipped a textarea-with-extra-fields and we should expect
bottleneck 1 to be unmoved.

---

## Sequencing summary

| Step | What                          | Cost      | Bottleneck moved | Independently shippable? |
|------|-------------------------------|-----------|------------------|--------------------------|
| 1    | Autonomy data + gate logic    | half-day  | #3               | yes                      |
| 2    | Decision card v2              | half-day  | #4               | yes                      |
| 3    | Scoping surface + handoff     | ~2 days   | #1               | yes (opt-in)             |
| 4    | Polish + SpawnModal cutover   | half-day  | (compounds)      | yes                      |

Total: ~3.5 days of focused work to ship Group A. Each step is
shippable independently if priorities shift.

**Recommended start: Step 1.** Smallest, removes a real and
constantly-felt operator pain (approval tax on test failures),
and lays the data model the other two steps benefit from.
