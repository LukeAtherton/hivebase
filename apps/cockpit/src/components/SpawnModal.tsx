import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type ProjectRow } from '../lib/api';

// MISSION BRIEF — cockpit-native spawn surface. Slides in from the left,
// full-height, hard edges, monospace caps. Replaces the previous generic
// centred modal which read as Vercel chrome.
export function SpawnModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  });

  const [projectId, setProjectId] = useState<string>('');
  const [task, setTask] = useState('');
  const [branch, setBranch] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');

  // Esc closes
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

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-y-0 left-0 flex h-full w-[480px] flex-col border-r border-accent/30 bg-panel/98 shadow-[0_0_60px_rgba(125,211,252,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header strip */}
        <div className="flex shrink-0 items-center justify-between border-b border-accent/30 bg-ink/40 px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              ▸ mission brief
            </div>
            <div className="mt-0.5 text-xs text-muted">spawn a new local agent into a worktree</div>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-border bg-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
          >
            esc
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Territory pick */}
          <div>
            <Label>territory</Label>
            {!creating ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {list.map((p) => (
                  <button
                    key={p.cockpitProjectId}
                    onClick={() => setProjectId(p.cockpitProjectId)}
                    className={clsx(
                      'rounded border px-3 py-2 text-left transition-colors',
                      projectId === p.cockpitProjectId
                        ? 'border-accent bg-accent/15 text-accent shadow-[0_0_12px_rgba(125,211,252,0.4)]'
                        : 'border-border bg-ink/40 text-text hover:border-accent/50',
                    )}
                  >
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                      {p.kind}
                    </div>
                    <div className="text-sm font-medium">{p.name}</div>
                  </button>
                ))}
                <button
                  onClick={() => setCreating(true)}
                  className="rounded border border-dashed border-border px-3 py-2 text-left text-muted hover:border-accent/40 hover:text-accent"
                >
                  <div className="font-mono text-[10px] uppercase tracking-widest">add</div>
                  <div className="text-sm">+ register repo</div>
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2 rounded border border-border bg-ink/40 p-3">
                <input
                  placeholder="project name"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded border border-border bg-ink px-2 py-1.5 text-sm text-text"
                />
                <input
                  placeholder="absolute repo path"
                  value={newRepoPath}
                  onChange={(e) => setNewRepoPath(e.target.value)}
                  className="w-full rounded border border-border bg-ink px-2 py-1.5 font-mono text-xs text-text"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setCreating(false)}
                    className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
                  >
                    cancel
                  </button>
                  <button
                    disabled={!newName || !newRepoPath || createProject.isPending}
                    onClick={() => createProject.mutate()}
                    className="rounded border border-accent/60 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-accent disabled:opacity-50"
                  >
                    {createProject.isPending ? 'registering…' : 'register'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Task brief */}
          <div>
            <Label>brief</Label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={5}
              autoFocus={!creating}
              className="mt-2 w-full rounded border border-border bg-ink px-3 py-2 font-mono text-xs text-text placeholder:text-muted"
              placeholder="what should the agent do?"
            />
          </div>

          {/* Callsign + branch */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>callsign</Label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-2 w-full rounded border border-border bg-ink px-3 py-1.5 text-sm text-text placeholder:text-muted"
                placeholder="auth refactor"
              />
            </div>
            <div>
              <Label>branch</Label>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="mt-2 w-full rounded border border-border bg-ink px-3 py-1.5 font-mono text-xs text-text placeholder:text-muted"
                placeholder="auto"
              />
            </div>
          </div>

          {spawn.error && (
            <div className="rounded border border-alarm/40 bg-alarm/10 px-3 py-2 text-xs text-alarm">
              {(spawn.error as Error).message}
            </div>
          )}
        </div>

        {/* Footer launch button */}
        <div className="flex shrink-0 items-center justify-between border-t border-accent/30 bg-ink/40 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {projectId && task ? 'ready · launch' : 'select territory + brief'}
          </div>
          <button
            disabled={!projectId || !task || spawn.isPending}
            onClick={() => spawn.mutate()}
            className={clsx(
              'rounded border-2 px-6 py-2 font-mono text-xs uppercase tracking-[0.3em] transition-colors',
              projectId && task && !spawn.isPending
                ? 'border-ok bg-ok/30 text-ok shadow-[0_0_14px_rgba(34,197,94,0.55)] hover:bg-ok/45'
                : 'border-border bg-ink text-muted cursor-not-allowed',
            )}
          >
            {spawn.isPending ? 'launching…' : '▸ launch'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">{children}</div>
  );
}
