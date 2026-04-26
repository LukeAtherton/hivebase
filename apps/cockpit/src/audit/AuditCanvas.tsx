// The "audit canvas" route — but rendered as a scrolling workflow
// document, not a graph. We tried React Flow and the graph framing
// fought the content: the audit's primary value is rich annotated
// snapshots + critique per state, not topology between states.
//
// This page renders each workflow as a vertical section with the
// canonical state sequence laid out left-to-right within the section.
// Snapshots inline at full readable size; annotations overlaid; the
// per-state description, "today", "gap", bottlenecks, foundations
// rendered alongside.

import { useMemo, useState } from 'react';
import { auditNodes, type AuditNodeData } from './nodes';
import { workflows, crossCuttingNodeIds, type WorkflowDefinition } from './workflows';
import { Snapshot } from './Snapshot';

const nodeIndex: Record<string, AuditNodeData> = Object.fromEntries(
  auditNodes.map((n) => [n.id, n]),
);

const SEVERITY_RING: Record<AuditNodeData['severity'], string> = {
  red: 'border-alarm/60 shadow-[0_0_12px_rgba(248,113,113,0.25)]',
  amber: 'border-warn/60 shadow-[0_0_10px_rgba(250,204,21,0.18)]',
  calm: 'border-ok/40',
  neutral: 'border-border',
};

const STAGE_STRIPE: Record<AuditNodeData['stage'], string> = {
  fleet: 'border-l-muted',
  scoping: 'border-l-accent',
  implementation: 'border-l-text',
  verification: 'border-l-warn',
  'cross-cutting': 'border-l-muted',
};

const BOTTLENECK_COLOUR: Record<WorkflowDefinition['bottleneck'], string> = {
  '#1 spawn': 'text-accent',
  '#2 peripheral': 'text-warn',
  '#3 approval-tax': 'text-warn',
  '#4 decision-context': 'text-alarm',
  baseline: 'text-muted',
};

export function AuditCanvas() {
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);

  // Track which workflow section is currently in view via IntersectionObserver-
  // free scroll heuristic. (Light touch — sidebar highlights the visible one.)
  const workflowsList = useMemo(() => workflows, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink text-text">
      {/* Sidebar */}
      <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-panel">
        <div className="sticky top-0 z-10 border-b border-border bg-panel px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            ▸ ux audit
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-muted">
            workflows · stages · bottlenecks
          </div>
          <a
            href="/"
            className="mt-3 inline-block rounded border border-border bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
          >
            ← cockpit
          </a>
        </div>
        <nav className="flex flex-col gap-px p-2">
          <div className="mb-1 mt-1 px-2 font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
            workflows
          </div>
          {workflowsList.map((wf) => (
            <a
              key={wf.id}
              href={`#${wf.id}`}
              onClick={() => setActiveWorkflow(wf.id)}
              className={`block rounded px-2 py-1.5 text-[11px] leading-snug transition-colors hover:bg-ink ${
                activeWorkflow === wf.id ? 'bg-ink text-text' : 'text-muted'
              }`}
            >
              <div className={`font-mono text-[9px] uppercase tracking-[0.2em] ${BOTTLENECK_COLOUR[wf.bottleneck]}`}>
                {wf.bottleneck}
              </div>
              <div className="mt-0.5">{wf.title}</div>
            </a>
          ))}

          <div className="mb-1 mt-3 px-2 font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
            cross-cutting
          </div>
          {crossCuttingNodeIds.map((id) => {
            const n = nodeIndex[id];
            if (!n) return null;
            return (
              <a
                key={id}
                href={`#node-${id}`}
                className="block rounded px-2 py-1 text-[11px] text-muted hover:bg-ink hover:text-text"
              >
                {n.title}
              </a>
            );
          })}

          <div className="mb-1 mt-3 px-2 font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
            bottlenecks
          </div>
          <div className="px-2 text-[11px] leading-relaxed text-muted">
            <div className="text-accent">#1 spawn friction</div>
            <div className="text-alarm">#4 decision context</div>
            <div className="text-warn">#3 approval tax</div>
            <div className="text-warn">#2 peripheral attention</div>
          </div>
        </nav>
      </aside>

      {/* Main scroll area */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 py-10">
          <Header />
          {workflowsList.map((wf) => (
            <WorkflowSection key={wf.id} wf={wf} />
          ))}
          <CrossCuttingSection />
          <Footer />
        </div>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-12 border-b border-border pb-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
        ▸ ux audit · workflow walk
      </div>
      <h1 className="mt-2 text-2xl font-semibold leading-tight">
        Cockpit UX, walked one workflow at a time
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
        Each section below is a canonical user story traced through the cockpit's current
        UI. The screenshots are real captures against deterministically-seeded mock data
        (see <code className="rounded bg-panel px-1 font-mono text-xs">db:seed</code> +{' '}
        <code className="rounded bg-panel px-1 font-mono text-xs">canvas:snapshot</code>).
        Highlights call out the relevant components; the critique below each step names
        what works, what doesn't, and which of the four operator-named bottlenecks bites.
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono uppercase tracking-wider text-accent">
          #1 spawn friction
        </span>
        <span className="rounded border border-alarm/40 bg-alarm/10 px-2 py-0.5 font-mono uppercase tracking-wider text-alarm">
          #4 decision context
        </span>
        <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono uppercase tracking-wider text-warn">
          #3 approval tax
        </span>
        <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono uppercase tracking-wider text-warn">
          #2 peripheral attention
        </span>
      </div>
    </header>
  );
}

function WorkflowSection({ wf }: { wf: WorkflowDefinition }) {
  const steps = wf.steps.map((id) => nodeIndex[id]).filter(Boolean);
  return (
    <section id={wf.id} className="mb-16 scroll-mt-8">
      <div className="mb-6 border-l-2 border-accent pl-4">
        <div className={`font-mono text-[10px] uppercase tracking-[0.3em] ${BOTTLENECK_COLOUR[wf.bottleneck]}`}>
          {wf.bottleneck === 'baseline' ? '· baseline path' : `· stresses ${wf.bottleneck}`}
        </div>
        <h2 className="mt-1 text-xl font-semibold">{wf.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{wf.premise}</p>
      </div>

      <ol className="flex flex-col gap-6">
        {steps.map((step, i) => (
          <li key={`${wf.id}-${step.id}`} className="relative">
            <div className="absolute -left-12 top-2 hidden md:flex h-8 w-8 items-center justify-center rounded-full border border-border bg-panel font-mono text-[11px] text-muted">
              {i + 1}
            </div>
            <StepCard data={step} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function CrossCuttingSection() {
  return (
    <section id="cross-cutting" className="mb-16 scroll-mt-8">
      <div className="mb-6 border-l-2 border-muted pl-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
          · cross-cutting infrastructure
        </div>
        <h2 className="mt-1 text-xl font-semibold">Out-of-window channels and missing plumbing</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Pieces that aren't tied to a single workflow but show up in many: the
          always-visible summary line, the missing audio + OS notification channel,
          the missing away/recap surface.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {crossCuttingNodeIds.map((id) => {
          const n = nodeIndex[id];
          if (!n) return null;
          return (
            <div key={id} id={`node-${id}`} className="scroll-mt-8">
              <StepCard data={n} compact />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepCard({ data, compact = false }: { data: AuditNodeData; compact?: boolean }) {
  const ring = SEVERITY_RING[data.severity];
  const stripe = STAGE_STRIPE[data.stage];
  return (
    <article
      id={`node-${data.id}`}
      className={`overflow-hidden rounded border bg-panel ${ring} border-l-4 ${stripe} scroll-mt-8`}
    >
      <header className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            {data.stage}
            {data.seedSessionIx && (
              <span className="ml-2 text-accent">▸ seed S{String(data.seedSessionIx).padStart(2, '0')}</span>
            )}
          </div>
          <h3 className="mt-1 text-base font-semibold">{data.title}</h3>
        </div>
        {data.bottlenecks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.bottlenecks.map((b) => (
              <span
                key={b}
                className="rounded border border-border bg-ink/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className={compact ? 'p-5' : 'grid grid-cols-1 gap-6 p-5 lg:grid-cols-[1.4fr_1fr]'}>
        <SnapshotPanel data={data} />


        <div className="min-w-0 space-y-4">
          <p className="text-[13px] leading-relaxed">{data.description}</p>

          {data.uiToday && (
            <Section label="what today's UI does" colour="text-text">
              {data.uiToday}
            </Section>
          )}
          {data.uiGap && (
            <Section label="gap" colour="text-warn">
              {data.uiGap}
            </Section>
          )}
          {data.foundations && data.foundations.length > 0 && (
            <Section label="relevant foundations" colour="text-muted">
              <ul className="mt-1 list-disc pl-4">
                {data.foundations.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </article>
  );
}

// Render either the captured snapshot (with annotations + open-live link)
// or a "proposed view — not built" placeholder. A node has a snapshot if
// either it points at a seeded session OR it has highlights and the
// snapshot pipeline captured the default cockpit view for it.
function SnapshotPanel({ data }: { data: AuditNodeData }) {
  const hasCapture = !!(data.seedSessionIx || (data.highlights && data.highlights.length > 0));
  if (!hasCapture) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded border border-dashed border-border/60 bg-ink/40 px-6 py-10 text-center text-[12px] leading-relaxed text-muted">
        <span>
          <span className="block font-mono uppercase tracking-widest text-warn">
            proposed view — not built
          </span>
          <span className="mt-2 block">{data.summary}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <Snapshot nodeId={data.id} size="full" showAnnotations />
      <a
        href={
          data.seedSessionIx
            ? `/?session=ckse_seed_${String(data.seedSessionIx).padStart(2, '0')}_____________`
            : '/'
        }
        target="_blank"
        rel="noopener"
        className="mt-2 inline-block rounded border border-accent/60 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:bg-accent/20"
      >
        open live ▸
      </a>
    </div>
  );
}

function Section({
  label,
  colour,
  children,
}: {
  label: string;
  colour: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`font-mono text-[9px] uppercase tracking-[0.3em] ${colour}`}>{label}</div>
      <div className="mt-1 text-[12px] leading-relaxed">{children}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-center text-[11px] text-muted">
      Snapshots regenerate via{' '}
      <code className="rounded bg-panel px-1 font-mono">pnpm --filter @kybernos/cockpit canvas:snapshot</code>
      . Mock data via{' '}
      <code className="rounded bg-panel px-1 font-mono">pnpm --filter @kybernos/platform db:seed</code>.
    </footer>
  );
}
