// Two-pane scoping surface (Group A step 3e).
//
// Left: live transcript with the read-only scoping agent.
// Right: editable scope artifact (task / acceptance criteria / non-goals /
//        touch surface / autonomy preset).
// Footer: agree / send-back actions.
//
// The artifact is the entire context the implementation agent will see
// post-handoff (per agent-handoff-decision.md), so this surface is the
// load-bearing scoping bottleneck-1 fix.
//
// Opt-in via setScopingSurface(true). SpawnModal is still wired in
// parallel; the two cut over to scope-only in step 4.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  api,
  type DecisionRow,
  type EventRow,
  type ProjectRow,
  type ScopeArtifactRow,
  type SessionRow,
} from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';
import { SeedPromptEditor } from './SeedPromptEditor';

type Phase = 'project' | 'started' | 'agreed';

export function ScopingSurface({ onClose }: { onClose: () => void }) {
  const presetProjectId = useCockpitStore((s) => s.scopingTargetProjectId);
  const [phase, setPhase] = useState<Phase>('project');

  // After /scope/start succeeds we hold the new ids locally; the artifact
  // pane and chat pane both read off them.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);

  // Esc closes the surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'started') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
      onClick={() => phase !== 'started' && onClose()}
    >
      <div
        className="briefing-frame absolute inset-y-0 right-0 flex h-full w-[1080px] max-w-full flex-col border-l border-accent/30 bg-panel/98 shadow-[0_0_60px_rgba(125,211,252,0.18)]"
        style={{ ['--briefing-bracket-size' as string]: '20px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="briefing-corners-tr" />
        <span className="briefing-corners-bl" />
        <header className="relative flex shrink-0 items-end justify-between gap-4 border-b border-accent/30 bg-ink/40 px-6 pb-3 pt-4">
          {/* Slate-style designator. */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[26px] leading-none tracking-[0.18em] text-accent drop-shadow-[0_0_12px_rgba(125,211,252,0.35)]">
                scoping
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted">
                ── mission briefing
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted/90">
              read-only investigation · operator drafts the handoff · implementation agent spawns on agree
            </div>
          </div>
          {/* Coordinates strip + close. */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right md:block">
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
                phase
              </div>
              <div className="font-display text-[13px] uppercase tracking-[0.25em] text-text">
                {phase === 'project' ? 'intake' : phase === 'started' ? 'live' : 'agreed'}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded border border-border bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:border-accent/60 hover:text-text"
            >
              ✕ close
            </button>
          </div>
        </header>

        {phase === 'project' && (
          <ProjectPickerPhase
            presetProjectId={presetProjectId}
            onStarted={(r) => {
              setSessionId(r.cockpitSessionId);
              setArtifactId(r.cockpitScopeArtifactId);
              setPhase('started');
            }}
          />
        )}
        {phase === 'started' && sessionId && artifactId && (
          <ScopingPhase
            sessionId={sessionId}
            artifactId={artifactId}
            onAgreed={() => setPhase('agreed')}
          />
        )}
        {phase === 'agreed' && <AgreedPhase onClose={onClose} />}
      </div>
    </div>
  );
}

// --- Phase 1: exploration view (territory brief + seed prompt) -----------
//
// Two-column layout. Left = territory brief (recent activity in the
// project, so the operator walks in with context); right = seed prompt
// markdown editor with image drop. When no project is preselected the
// brief column degrades into a project picker grid.

function ProjectPickerPhase({
  presetProjectId,
  onStarted,
}: {
  presetProjectId: string | null;
  onStarted: (r: { cockpitSessionId: string; cockpitScopeArtifactId: string }) => void;
}) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.listProjects() });
  const [projectId, setProjectId] = useState(presetProjectId ?? '');
  const [seed, setSeed] = useState('');
  const start = useMutation({
    mutationFn: () =>
      api.scopeStart({
        cockpitProjectId: projectId,
        seedPrompt: seed,
        label: 'scoping',
      }),
    onSuccess: (r) =>
      onStarted({
        cockpitSessionId: r.cockpitSessionId,
        cockpitScopeArtifactId: r.cockpitScopeArtifactId,
      }),
  });
  const list: ProjectRow[] = projects.data?.projects ?? [];
  const selectedProject = list.find((p) => p.cockpitProjectId === projectId) ?? null;
  const ready = !!projectId && !!seed.trim() && !start.isPending;

  // Mission timestamp shown in the slate rail — formatted once on
  // mount, then updated minute-tick.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const statusLine = !projectId
    ? 'select territory ↦'
    : !seed.trim()
      ? 'awaiting seed prompt'
      : start.isPending
        ? 'spawning scoping agent…'
        : 'ready for handoff';

  return (
    <div className="grid flex-1 grid-cols-[24px_440px_1fr] overflow-hidden">
      {/* Slate rail — film-slate / flight-deck timecode column. */}
      <div className="briefing-tick-rail relative flex h-full flex-col items-center justify-between border-r border-border/60 bg-ink/30 py-3">
        <div className="flex flex-col items-center gap-2">
          <span
            className="block h-1.5 w-1.5 rounded-full bg-alarm shadow-[0_0_6px_rgba(239,68,68,0.7)] animate-rec-pulse"
            aria-hidden
          />
          <span
            className="rotate-180 font-display text-[9px] uppercase tracking-[0.3em] text-muted"
            style={{ writingMode: 'vertical-rl' }}
          >
            rec
          </span>
        </div>
        <span
          className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted"
          style={{ writingMode: 'vertical-rl' }}
        >
          {now
            .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
            .replace(':', ' · ')}
        </span>
      </div>

      {/* Left: territory brief or project picker. */}
      <aside
        className="flex h-full flex-col overflow-hidden border-r border-border bg-ink/30 animate-briefing-rise"
        style={{ animationDelay: '40ms' }}
      >
        {selectedProject ? (
          <TerritoryBrief
            project={selectedProject}
            onChangeTerritory={presetProjectId ? undefined : () => setProjectId('')}
          />
        ) : (
          <ProjectPicker
            projects={list}
            selectedId={projectId}
            onSelect={setProjectId}
            loading={projects.isLoading}
          />
        )}
      </aside>

      {/* Right: seed prompt editor + start button. */}
      <section
        className="flex h-full flex-col overflow-hidden animate-briefing-rise"
        style={{ animationDelay: '160ms' }}
      >
        <div className="flex shrink-0 items-end justify-between border-b border-border bg-ink/40 px-5 pb-2.5 pt-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[14px] uppercase tracking-[0.2em] text-text">
              seed prompt
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted/80">
              ── markdown · drop or paste images
            </span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
            {seed.length > 0 ? `${seed.length} ch` : '—'}
          </span>
        </div>
        <div className="relative flex-1 overflow-hidden px-5 py-4">
          <div
            className="briefing-frame relative h-full"
            style={{
              ['--briefing-bracket-color' as string]: 'rgba(125,211,252,0.45)',
              ['--briefing-bracket-size' as string]: '16px',
            }}
          >
            <span className="briefing-corners-tr" />
            <span className="briefing-corners-bl" />
            <SeedPromptEditor
              value={seed}
              onChange={setSeed}
              placeholder={
                '# what are we scoping?\n\ndescribe the goal · paste a screenshot · drop a design\n\nthe scoping agent will investigate read-only and propose a scope artifact you can refine before handing off.'
              }
            />
            {/* Empty-state scan-line: drifts top→bottom when the editor
                is empty, signals "instrument hot, awaiting input". */}
            {seed.length === 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent shadow-[0_0_6px_rgba(125,211,252,0.4)] animate-instrument-sweep"
              />
            )}
          </div>
        </div>
        {start.error && (
          <div className="mx-5 mb-2 rounded border border-alarm/40 bg-alarm/10 px-3 py-2 font-mono text-[11px] text-alarm">
            ▲ {(start.error as Error).message}
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-ink/50 px-5 py-3">
          <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.3em]">
            <span
              className={clsx(
                'inline-block h-1.5 w-1.5 rounded-full',
                ready
                  ? 'bg-ok shadow-[0_0_6px_rgba(34,197,94,0.7)]'
                  : start.isPending
                    ? 'bg-accent shadow-[0_0_6px_rgba(125,211,252,0.7)] animate-rec-pulse'
                    : 'bg-muted/70',
              )}
              aria-hidden
            />
            <span className={ready ? 'text-ok' : 'text-muted'}>{statusLine}</span>
          </div>
          <button
            disabled={!ready}
            onClick={() => start.mutate()}
            className={clsx(
              'group relative overflow-hidden rounded-sm border-2 px-7 py-2 font-display text-[13px] uppercase tracking-[0.32em] transition-colors',
              ready
                ? 'border-accent bg-accent/15 text-accent shadow-[0_0_18px_rgba(125,211,252,0.45)] hover:bg-accent/30'
                : 'border-border bg-ink text-muted cursor-not-allowed',
            )}
          >
            <span className="relative z-10">
              {start.isPending ? '▸ launching' : '▸ commence scoping'}
            </span>
            {ready && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-accent/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectPicker({
  projects,
  selectedId,
  onSelect,
  loading,
}: {
  projects: ProjectRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-ink/40 px-5 pb-2.5 pt-3">
        <div className="font-display text-[14px] uppercase tracking-[0.2em] text-text">
          territory
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted/80">
          ── select a project to brief on
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="py-12 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            ··· loading
          </div>
        ) : projects.length === 0 ? (
          <div className="py-12 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            no territories · add a project on the canvas
          </div>
        ) : (
          <ul className="space-y-1.5">
            {projects.map((p, idx) => (
              <li
                key={p.cockpitProjectId}
                className="animate-briefing-rise"
                style={{ animationDelay: `${80 + idx * 24}ms` }}
              >
                <button
                  onClick={() => onSelect(p.cockpitProjectId)}
                  className={clsx(
                    'w-full rounded-sm border px-3 py-2 text-left transition-colors',
                    selectedId === p.cockpitProjectId
                      ? 'border-accent bg-accent/15 text-accent shadow-[0_0_12px_rgba(125,211,252,0.4)]'
                      : 'border-border bg-ink/40 text-text hover:border-accent/50',
                  )}
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
                    {p.kind}
                  </div>
                  <div className="font-display text-[15px] tracking-[0.05em]">{p.name}</div>
                  {p.repoPath && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                      {p.repoPath}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TerritoryBrief({
  project,
  onChangeTerritory,
}: {
  project: ProjectRow;
  onChangeTerritory?: () => void;
}) {
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.listSessions(),
    refetchInterval: 10_000,
  });
  const decisionsQ = useQuery({
    queryKey: ['decisions', 'open'],
    queryFn: () => api.listDecisions('open'),
    refetchInterval: 10_000,
  });

  const projectSessions = useMemo<SessionRow[]>(
    () =>
      (sessionsQ.data?.sessions ?? []).filter(
        (s) => s.cockpitProjectId === project.cockpitProjectId,
      ),
    [sessionsQ.data, project.cockpitProjectId],
  );
  const activeSessions = projectSessions.filter(
    (s) => s.state !== 'stopped' && s.state !== 'completed',
  );
  const projectDecisions = useMemo<DecisionRow[]>(() => {
    const sessionIds = new Set(projectSessions.map((s) => s.cockpitSessionId));
    return (decisionsQ.data?.decisions ?? []).filter((d) =>
      sessionIds.has(d.cockpitSessionId),
    );
  }, [decisionsQ.data, projectSessions]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Territory callsign card — the headline of the briefing. */}
      <div
        className="briefing-frame relative shrink-0 border-b border-accent/30 bg-gradient-to-b from-accent/[0.10] via-accent/[0.04] to-transparent px-5 pb-4 pt-4 animate-briefing-rise"
        style={{
          ['--briefing-bracket-color' as string]: 'rgba(125,211,252,0.6)',
          ['--briefing-bracket-size' as string]: '14px',
          animationDelay: '60ms',
        }}
      >
        <span className="briefing-corners-tr" />
        <span className="briefing-corners-bl" />
        <div className="flex items-center justify-between">
          <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-accent/90">
            ▸ territory · {project.kind}
          </div>
          {onChangeTerritory && (
            <button
              onClick={onChangeTerritory}
              className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted hover:text-accent"
            >
              change ↻
            </button>
          )}
        </div>
        <div className="mt-2 font-display text-[28px] uppercase leading-none tracking-[0.1em] text-accent drop-shadow-[0_0_10px_rgba(125,211,252,0.35)]">
          {project.name}
        </div>
        {project.repoPath && (
          <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted">
            <span className="text-muted/70">┝</span>
            <span className="truncate">{project.repoPath}</span>
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Gauge label="active" value={activeSessions.length} tone="accent" />
          <Gauge
            label="open dec"
            value={projectDecisions.length}
            tone={projectDecisions.length > 0 ? 'alarm' : 'muted'}
          />
          <Gauge label="lifetime" value={projectSessions.length} tone="muted" />
        </div>
      </div>

      {/* Existing sessions in this project. */}
      <BriefSection title="agents in territory" delayMs={140}>
        {activeSessions.length === 0 ? (
          <Empty>no active agents · this would be the first</Empty>
        ) : (
          <ul className="space-y-1">
            {activeSessions.map((s) => (
              <li
                key={s.cockpitSessionId}
                className="rounded-sm border border-border/60 bg-ink/40 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-text">
                    {s.agentLabel ?? s.task.slice(0, 40)}
                  </span>
                  <StateBadge state={s.state} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </BriefSection>

      {/* Open decisions in this project. */}
      <BriefSection title="open decisions" delayMs={220}>
        {projectDecisions.length === 0 ? (
          <Empty>queue is clear</Empty>
        ) : (
          <ul className="space-y-1">
            {projectDecisions.slice(0, 6).map((d) => (
              <li
                key={d.cockpitDecisionId}
                className="rounded-sm border border-border/60 bg-ink/40 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'shrink-0 font-mono text-[9px] uppercase tracking-[0.25em]',
                      d.severity === 'required' && 'text-alarm',
                      d.severity === 'advisory' && 'text-warn',
                      d.severity === 'info' && 'text-muted',
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="truncate font-mono text-[11px] text-text">{d.question}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </BriefSection>

      {/* Spacer to push content up if both sections are short. */}
      <div className="flex-1" />

      {/* Footer slug — film-slate identifier line. */}
      <div className="shrink-0 border-t border-border/40 bg-ink/40 px-5 py-2 font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
        ID · {project.cockpitProjectId.slice(-10)}
      </div>
    </div>
  );
}

function Gauge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'accent' | 'alarm' | 'muted';
}) {
  const fg =
    tone === 'accent' ? 'text-accent' : tone === 'alarm' ? 'text-alarm' : 'text-text/80';
  const tickFg =
    tone === 'accent'
      ? 'rgba(125,211,252,0.45)'
      : tone === 'alarm'
        ? 'rgba(239,68,68,0.45)'
        : 'rgba(90,101,115,0.5)';
  return (
    <div className="relative overflow-hidden rounded-sm border border-border/60 bg-ink/40 px-2 pt-1.5 pb-1">
      {/* Tick row — 5 short ticks inside the tile, evenly spaced. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-1 top-1.5 h-px"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${tickFg} 0, ${tickFg} 1px, transparent 1px, transparent 12px)`,
        }}
      />
      <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">{label}</div>
      <div
        className={clsx(
          'mt-1 font-display text-[20px] leading-none tabular-nums tracking-[0.05em]',
          fg,
        )}
      >
        {String(value).padStart(2, '0')}
      </div>
    </div>
  );
}

function BriefSection({
  title,
  children,
  delayMs,
}: {
  title: string;
  children: React.ReactNode;
  delayMs?: number;
}) {
  return (
    <div
      className="shrink-0 border-b border-border/40 px-5 py-3 animate-briefing-rise"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-px w-3 bg-muted/40" aria-hidden />
        <span className="font-display text-[11px] uppercase tracking-[0.3em] text-muted">
          {title}
        </span>
        <span className="h-px flex-1 bg-muted/20" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-border/60 bg-ink/20 px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
      {children}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone =
    state === 'needs-decision' || state === 'blocked'
      ? 'border-alarm/50 bg-alarm/10 text-alarm'
      : state === 'implementing' || state === 'scoping'
        ? 'border-accent/50 bg-accent/10 text-accent'
        : state === 'queued'
          ? 'border-warn/50 bg-warn/10 text-warn'
          : 'border-border bg-ink/40 text-muted';
  return (
    <span
      className={clsx(
        'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest',
        tone,
      )}
    >
      {state}
    </span>
  );
}

// --- Phase 2: live chat + editable artifact ------------------------------

function ScopingPhase({
  sessionId,
  artifactId,
  onAgreed,
}: {
  sessionId: string;
  artifactId: string;
  onAgreed: () => void;
}) {
  return (
    <div className="grid flex-1 grid-cols-[1fr_440px] overflow-hidden">
      <ChatPane sessionId={sessionId} />
      <ArtifactPane artifactId={artifactId} sessionId={sessionId} onAgreed={onAgreed} />
    </div>
  );
}

function ChatPane({ sessionId }: { sessionId: string }) {
  const events = useQuery({
    queryKey: ['session-events', sessionId],
    queryFn: () => api.listSessionEvents(sessionId, 200),
    refetchInterval: 3_000,
  });
  const [reply, setReply] = useState('');
  const send = useMutation({
    mutationFn: (text: string) => api.sendSessionMessage(sessionId, text),
    onSuccess: () => setReply(''),
  });

  const list: EventRow[] = events.data?.events ?? [];
  const visible = list
    .filter((e) => e.type === 'text.delta' || e.type === 'tool.pre' || e.type === 'tool.post' || e.type === 'notification')
    .slice()
    .reverse(); // server returns desc; flip for chronological top-to-bottom

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-border">
      <div className="border-b border-border bg-ink/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
        chat · scoping agent (read-only)
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-snug">
        {visible.length === 0 ? (
          <div className="py-12 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
            agent starting…
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((e) => (
              <li key={e.cockpitEventId} className="rounded border border-border/40 bg-ink/30 px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted">
                  {e.type}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-text/90">
                  {renderPayload(e)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-border bg-ink/40 px-3 py-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="reply to the scoping agent — direction, corrections, context"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) {
              e.preventDefault();
              send.mutate(reply.trim());
            }
          }}
          className="w-full rounded border border-border bg-ink px-2 py-1.5 font-mono text-[12px] text-text"
        />
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted">
          <span>⌘↵ send</span>
          <button
            disabled={!reply.trim() || send.isPending}
            onClick={() => send.mutate(reply.trim())}
            className="rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-accent disabled:opacity-50"
          >
            {send.isPending ? 'sending…' : 'send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderPayload(e: EventRow): string {
  if (e.type === 'text.delta') {
    const t = e.payload as { text?: string };
    return t.text ?? '';
  }
  if (e.type === 'tool.pre') {
    const p = e.payload as { toolName?: string; command?: string; filePath?: string };
    return `${p.toolName ?? 'tool'} → ${p.command ?? p.filePath ?? ''}`;
  }
  if (e.type === 'tool.post') {
    const p = e.payload as { toolName?: string; exitCode?: number };
    return `${p.toolName ?? 'tool'} exit=${p.exitCode ?? '?'}`;
  }
  if (e.type === 'notification') {
    const p = e.payload as { message?: string };
    return p.message ?? '';
  }
  return JSON.stringify(e.payload);
}

function ArtifactPane({
  artifactId,
  sessionId: _sessionId,
  onAgreed,
}: {
  artifactId: string;
  sessionId: string;
  onAgreed: () => void;
}) {
  const qc = useQueryClient();
  const artifact = useQuery({
    queryKey: ['scope-artifact', artifactId],
    queryFn: () => api.getScopeArtifact(artifactId),
    refetchInterval: 4_000,
  });

  // Local draft state. Synced from the server on first load + after each
  // patch; debounced PATCH on edits below.
  const [task, setTask] = useState('');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [nonGoals, setNonGoals] = useState<string[]>([]);
  const [touchSurface, setTouchSurface] = useState<string[]>([]);

  useEffect(() => {
    if (!artifact.data) return;
    setTask(artifact.data.task);
    setCriteria(artifact.data.acceptanceCriteria);
    setNonGoals(artifact.data.nonGoals);
    setTouchSurface(artifact.data.touchSurface);
  }, [artifact.data]);

  const patch = useMutation({
    mutationFn: (body: Partial<ScopeArtifactRow>) =>
      api.patchScopeArtifact(artifactId, {
        task: body.task,
        acceptanceCriteria: body.acceptanceCriteria,
        nonGoals: body.nonGoals,
        touchSurface: body.touchSurface,
        autonomyPreset: body.autonomyPreset,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['scope-artifact', artifactId], data);
    },
  });

  const agree = useMutation({
    mutationFn: () => api.agreeScopeArtifact(artifactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      onAgreed();
    },
  });

  const data = artifact.data;
  const readyToAgree = task.trim().length > 0 && criteria.filter((c) => c.trim()).length > 0;
  const locked = data?.status !== 'draft';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-ink/30 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
          scope artifact
        </span>
        <span
          className={clsx(
            'rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest',
            data?.status === 'draft' && 'border-warn/50 bg-warn/10 text-warn',
            data?.status === 'agreed' && 'border-ok/50 bg-ok/10 text-ok',
            data?.status === 'superseded' && 'border-muted bg-ink text-muted',
          )}
        >
          {data?.status ?? '…'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <Field label="task statement">
          <textarea
            disabled={locked}
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onBlur={() => patch.mutate({ task })}
            placeholder="The single sentence the implementation agent will be held to."
            className="w-full rounded border border-border bg-ink px-2 py-1.5 font-mono text-[12px] text-text disabled:opacity-60"
          />
        </Field>
        <ListField
          label="acceptance criteria"
          values={criteria}
          locked={locked}
          placeholder="testable success condition"
          onChange={(v) => {
            setCriteria(v);
            patch.mutate({ acceptanceCriteria: v });
          }}
        />
        <ListField
          label="non-goals"
          values={nonGoals}
          locked={locked}
          placeholder="explicit out-of-scope item"
          onChange={(v) => {
            setNonGoals(v);
            patch.mutate({ nonGoals: v });
          }}
        />
        <ListField
          label="touch surface"
          values={touchSurface}
          locked={locked}
          placeholder="path/to/file.ts"
          onChange={(v) => {
            setTouchSurface(v);
            patch.mutate({ touchSurface: v });
          }}
        />
        {agree.error && (
          <div className="rounded border border-alarm/40 bg-alarm/10 px-3 py-2 text-xs text-alarm">
            {(agree.error as Error).message}
          </div>
        )}
      </div>
      <div className="border-t border-accent/30 bg-ink/40 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {locked
            ? data?.status === 'agreed'
              ? 'agreed · implementation agent spawned'
              : 'artifact locked'
            : readyToAgree
              ? 'ready · agree to spawn implementation agent'
              : 'add task + ≥1 criterion to enable agree'}
        </div>
        <div className="mt-2 flex justify-end">
          <button
            disabled={locked || !readyToAgree || agree.isPending}
            onClick={() => agree.mutate()}
            className={clsx(
              'rounded border-2 px-6 py-2 font-mono text-xs uppercase tracking-[0.3em] transition-colors',
              !locked && readyToAgree && !agree.isPending
                ? 'border-ok bg-ok/30 text-ok shadow-[0_0_14px_rgba(34,197,94,0.55)] hover:bg-ok/45'
                : 'border-border bg-ink text-muted cursor-not-allowed',
            )}
          >
            {agree.isPending ? 'agreeing…' : '▸ agree'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Phase 3: agreed -----------------------------------------------------

function AgreedPhase({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ok">▸ scope agreed</div>
      <div className="text-sm text-text">
        Implementation agent spawned with the artifact as initial context.
      </div>
      <div className="text-xs text-muted">
        The scoping session has ended. Watch the portfolio map for the new agent.
      </div>
      <button
        onClick={onClose}
        className="mt-4 rounded border border-accent/60 bg-accent/10 px-6 py-2 font-mono text-xs uppercase tracking-widest text-accent hover:bg-accent/20"
      >
        return to cockpit
      </button>
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">{children}</div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ListField({
  label,
  values,
  locked,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  locked: boolean;
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const updateAt = (i: number, v: string) => {
    const next = values.slice();
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number) => {
    const next = values.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const append = () => onChange([...values, '']);

  return (
    <div>
      <Label>{label}</Label>
      <ul className="mt-2 space-y-1">
        {values.map((v, i) => (
          <li key={i} className="flex items-start gap-1">
            <span className="mt-2 font-mono text-[10px] text-muted">·</span>
            <input
              disabled={locked}
              value={v}
              onChange={(e) => updateAt(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded border border-border bg-ink px-2 py-1.5 font-mono text-[11px] text-text disabled:opacity-60"
            />
            <button
              disabled={locked}
              onClick={() => removeAt(i)}
              className="px-1 font-mono text-[10px] text-muted hover:text-alarm disabled:opacity-30"
              title="remove"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        disabled={locked}
        onClick={append}
        className="mt-1 rounded border border-dashed border-border px-2 py-1 font-mono text-[10px] text-muted hover:border-accent/50 hover:text-accent disabled:opacity-30"
      >
        + add
      </button>
    </div>
  );
}
