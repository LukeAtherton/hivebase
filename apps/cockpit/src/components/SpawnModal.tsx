// MISSION BRIEF — unified spawn surface in the briefing aesthetic.
//
// Spawn an agent into an existing project OR create a new project on
// the fly, in one centred modal. The store's `spawnModalPreset`
// drives initial state:
//   { projectId } → preselect that project ("spawn here")
//   { mode: 'new' } → open straight into the new-project sub-form
//   undefined      → no preselect, operator picks
//
// Aesthetic match for AddProjectModal/KeymapOverlay/ScopingSurface:
// corner-bracket frame, stencil display header, callsign-style
// labels, focus-glow inputs, stencil LAUNCH button.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type ProjectRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';
import { SeedPromptEditor } from './SeedPromptEditor';

export function SpawnModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const preset = useCockpitStore((s) => s.spawnModalPreset);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  });

  const [projectId, setProjectId] = useState<string>(preset?.projectId ?? '');
  const [task, setTask] = useState('');
  const [branch, setBranch] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(preset?.mode === 'new');
  const [newName, setNewName] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createProject = useMutation({
    mutationFn: () =>
      api.createProject({
        name: newName,
        kind: 'local-repo',
        repoPath: newRepoPath,
        workspaceId: 'wks_local',
        createdBy: 'me',
      }),
    onSuccess: ({ cockpitProjectId }) => {
      setProjectId(cockpitProjectId);
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const spawn = useMutation({
    mutationFn: () =>
      api.spawn({
        cockpitProjectId: projectId,
        agentType: 'claude-code-local',
        task,
        branch: branch || undefined,
        label: label || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
    },
  });

  const list: ProjectRow[] = projects.data?.projects ?? [];
  const ready = !!projectId && !!task.trim() && !spawn.isPending;
  const launchStatus = creating
    ? 'register territory first'
    : !projectId
      ? 'select territory ↦'
      : !task.trim()
        ? 'awaiting brief'
        : spawn.isPending
          ? 'launching agent…'
          : 'ready · launch';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="briefing-frame relative flex max-h-[88vh] w-[640px] flex-col overflow-hidden rounded-sm border border-accent/30 bg-panel/98 shadow-[0_0_60px_rgba(125,211,252,0.18)] animate-briefing-rise"
        style={{
          ['--briefing-bracket-color' as string]: 'rgba(125,211,252,0.6)',
          ['--briefing-bracket-size' as string]: '18px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="briefing-corners-tr" />
        <span className="briefing-corners-bl" />

        {/* Header */}
        <div className="shrink-0 border-b border-accent/30 bg-gradient-to-b from-accent/[0.08] to-transparent px-6 pb-4 pt-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-accent/90">
                ▸ mission brief
              </div>
              <div className="mt-2 font-display text-[24px] uppercase leading-none tracking-[0.14em] text-accent drop-shadow-[0_0_10px_rgba(125,211,252,0.35)]">
                spawn agent
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                ── select a territory · brief the agent · launch
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-sm border border-border bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-muted hover:border-accent/60 hover:text-text"
            >
              ✕ close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Territory */}
          <section>
            <Label>territory</Label>
            {!creating ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {list.map((p) => (
                  <button
                    key={p.cockpitProjectId}
                    onClick={() => setProjectId(p.cockpitProjectId)}
                    className={clsx(
                      'rounded-sm border px-3 py-2 text-left transition-colors',
                      projectId === p.cockpitProjectId
                        ? 'border-accent bg-accent/15 text-accent shadow-[0_0_12px_rgba(125,211,252,0.4)]'
                        : 'border-border bg-ink/40 text-text hover:border-accent/50',
                    )}
                  >
                    <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
                      {p.kind}
                    </div>
                    <div className="font-display text-[14px] tracking-[0.05em]">{p.name}</div>
                    {p.repoPath && (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                        {p.repoPath}
                      </div>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => setCreating(true)}
                  className="rounded-sm border border-dashed border-border px-3 py-2 text-left text-muted transition-colors hover:border-accent/60 hover:text-accent"
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.3em]">
                    + commission
                  </div>
                  <div className="font-display text-[14px] tracking-[0.05em]">register repo</div>
                  <div className="mt-0.5 font-mono text-[10px]">add a new territory</div>
                </button>
              </div>
            ) : (
              <div
                className="briefing-frame relative mt-2 rounded-sm border border-accent/40 bg-ink/40 p-4"
                style={{
                  ['--briefing-bracket-color' as string]: 'rgba(125,211,252,0.5)',
                  ['--briefing-bracket-size' as string]: '12px',
                }}
              >
                <span className="briefing-corners-tr" />
                <span className="briefing-corners-bl" />
                <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-accent/80">
                  ▸ commission territory
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                  ── register a new repo as a project
                </div>

                <div className="mt-3">
                  <Label>callsign</Label>
                  <input
                    autoFocus
                    placeholder="e.g. apex"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1.5 w-full rounded-sm border border-border bg-ink px-2.5 py-1.5 font-mono text-xs text-text focus:border-accent/60 focus:outline-none"
                  />
                </div>
                <div className="mt-3">
                  <Label>repo path (local)</Label>
                  <input
                    placeholder="/Users/.../Projects/apex"
                    value={newRepoPath}
                    onChange={(e) => setNewRepoPath(e.target.value)}
                    className="mt-1.5 w-full rounded-sm border border-border bg-ink px-2.5 py-1.5 font-mono text-xs text-text focus:border-accent/60 focus:outline-none"
                  />
                  <div className="mt-1 font-mono text-[10px] text-muted">
                    ── path on this machine · agents spawn worktrees from here
                  </div>
                </div>

                {createProject.error && (
                  <div className="mt-3 rounded-sm border border-alarm/40 bg-alarm/10 px-3 py-2 font-mono text-[11px] text-alarm">
                    ▲ {(createProject.error as Error).message}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setCreating(false)}
                    className="rounded-sm border border-border bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-muted hover:text-text"
                  >
                    cancel
                  </button>
                  <button
                    disabled={!newName || !newRepoPath || createProject.isPending}
                    onClick={() => createProject.mutate()}
                    className={clsx(
                      'rounded-sm border-2 px-4 py-1.5 font-display text-[12px] uppercase tracking-[0.3em] transition-colors',
                      newName && newRepoPath && !createProject.isPending
                        ? 'border-accent bg-accent/20 text-accent shadow-[0_0_12px_rgba(125,211,252,0.5)] hover:bg-accent/35'
                        : 'border-border bg-ink text-muted cursor-not-allowed',
                    )}
                  >
                    {createProject.isPending ? '▸ commissioning' : '+ register'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Brief — markdown editor with syntax highlighting and
              drop/paste image upload (same component the scoping
              surface uses). */}
          <section>
            <div className="flex items-baseline justify-between">
              <Label>brief</Label>
              <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted/80">
                ── markdown · drop or paste images
              </span>
            </div>
            <div className="mt-1.5 h-[200px]">
              <SeedPromptEditor
                value={task}
                onChange={setTask}
                placeholder={
                  '# what should the agent do?\n\ndescribe the goal · paste a screenshot · drop a design'
                }
              />
            </div>
          </section>

          {/* Callsign + Branch */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <Label>agent callsign</Label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1.5 w-full rounded-sm border border-border bg-ink px-2.5 py-1.5 font-mono text-xs text-text focus:border-accent/60 focus:outline-none placeholder:text-muted/70"
                placeholder="auth refactor"
              />
            </div>
            <div>
              <Label>branch</Label>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="mt-1.5 w-full rounded-sm border border-border bg-ink px-2.5 py-1.5 font-mono text-xs text-text focus:border-accent/60 focus:outline-none placeholder:text-muted/70"
                placeholder="auto"
              />
            </div>
          </section>

          {spawn.error && (
            <div className="rounded-sm border border-alarm/40 bg-alarm/10 px-3 py-2 font-mono text-[11px] text-alarm">
              ▲ {(spawn.error as Error).message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-ink/50 px-6 py-3">
          <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.3em]">
            <span
              className={clsx(
                'inline-block h-1.5 w-1.5 rounded-full',
                ready
                  ? 'bg-ok shadow-[0_0_6px_rgba(34,197,94,0.7)]'
                  : spawn.isPending
                    ? 'bg-accent shadow-[0_0_6px_rgba(125,211,252,0.7)] animate-rec-pulse'
                    : 'bg-muted/70',
              )}
              aria-hidden
            />
            <span className={ready ? 'text-ok' : 'text-muted'}>{launchStatus}</span>
          </div>
          <button
            disabled={!ready}
            onClick={() => spawn.mutate()}
            className={clsx(
              'group relative overflow-hidden rounded-sm border-2 px-7 py-2 font-display text-[13px] uppercase tracking-[0.32em] transition-colors',
              ready
                ? 'border-ok bg-ok/20 text-ok shadow-[0_0_18px_rgba(34,197,94,0.45)] hover:bg-ok/35'
                : 'border-border bg-ink text-muted cursor-not-allowed',
            )}
          >
            <span className="relative z-10">
              {spawn.isPending ? '▸ launching' : '▸ launch'}
            </span>
            {ready && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ok/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-[11px] uppercase tracking-[0.3em] text-muted">{children}</div>
  );
}
