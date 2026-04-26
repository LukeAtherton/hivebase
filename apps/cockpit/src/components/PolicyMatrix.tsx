// Read-only autonomy policy matrix for an agent.
//
// Shown in SessionDetail under a collapsed-by-default panel. Renders the
// 13 capabilities × 3 stages grid the gate logic in
// apps/cockpit-api/src/lib/persistence.ts consults. Cells are
// colour-coded: allow=green, ask=amber, never=red.
//
// Edit affordance is intentionally absent in step 1 — first ship the
// data + read; the editor is in step 4 of the Group A plan
// (docs/group-a-plan.md).

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type PolicyRow } from '../lib/api';

const CAPABILITIES = [
  'read-files',
  'edit-files',
  'run-tests',
  'run-build',
  'run-migrations',
  'push-branch',
  'open-pr',
  'merge-pr',
  'network-fetch',
  'install-package',
  'destructive',
  'delete-files',
  'spend-over-threshold',
] as const;
const STAGES = ['scoping', 'implementation', 'verification'] as const;

const LEVEL_STYLE: Record<PolicyRow['level'], string> = {
  allow: 'bg-ok/15 text-ok border-ok/40',
  ask: 'bg-warn/15 text-warn border-warn/40',
  never: 'bg-alarm/15 text-alarm border-alarm/40',
};

export function PolicyMatrix({ cockpitAgentId }: { cockpitAgentId: string }) {
  const q = useQuery({
    queryKey: ['agent-policies', cockpitAgentId],
    queryFn: () => api.listAgentPolicies(cockpitAgentId),
    enabled: !!cockpitAgentId,
  });

  if (!cockpitAgentId) return null;

  const policies = q.data?.policies ?? [];
  const lookup = (cap: string, stage: string): PolicyRow['level'] | null => {
    const row = policies.find((p) => p.capability === cap && p.stage === stage);
    return row?.level ?? null;
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
          autonomy policy
        </div>
        <div className="font-mono text-[9px] text-muted">
          {q.isLoading ? 'loading…' : `${policies.length} rules`}
        </div>
      </div>
      {policies.length === 0 && !q.isLoading ? (
        <div className="mt-2 text-[11px] text-muted">
          No policy attached. Decisions route through the classifier as 'ask'.
        </div>
      ) : (
        <div className="mt-2 max-h-48 overflow-y-auto overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="border-b border-border px-1 py-1 text-left font-mono uppercase tracking-widest text-muted">
                  capability
                </th>
                {STAGES.map((s) => (
                  <th
                    key={s}
                    className="border-b border-border px-1 py-1 text-center font-mono uppercase tracking-widest text-muted"
                  >
                    {s.slice(0, 4)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c}>
                  <td className="px-1 py-0.5 font-mono text-muted">{c}</td>
                  {STAGES.map((s) => {
                    const lvl = lookup(c, s);
                    return (
                      <td key={s} className="px-1 py-0.5 text-center">
                        {lvl ? (
                          <span
                            className={clsx(
                              'inline-block min-w-[42px] rounded border px-1.5 py-0.5 font-mono uppercase tracking-wider',
                              LEVEL_STYLE[lvl],
                            )}
                          >
                            {lvl}
                          </span>
                        ) : (
                          <span className="text-muted/60">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
