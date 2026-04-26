// Shared helpers for /spawn and /scope/start.
//
// Both endpoints create the same chain (worktree + agent + autonomy
// policy attachment + session + adapter spawn). The only difference is
// the session's `stage` and what gets returned. Factoring the shared
// piece keeps the two routes readable and makes future stage-aware
// spawn types (verification agents, autoresearch test agents) cheap.

import { eq, sql } from 'drizzle-orm';
import {
  cockpitAgents,
  cockpitAutonomyPolicies,
  cockpitProjects,
  cockpitSessions,
  getCockpitDb,
} from '@kybernos/platform';
import {
  generateCockpitAgentId,
  generateCockpitAutonomyPolicyId,
  generateCockpitSessionId,
} from '@kybernos/ids';
import type { AgentStage } from '@kybernos/core';
import { ClaudeCodeLocalAdapter } from '../adapters/claude-code/adapter.js';
import { createWorktree } from './worktrees.js';

export interface SpawnAgentArgs {
  cockpitProjectId: string;
  task: string;
  stage: AgentStage;
  branch?: string;
  baseBranch?: string;
  label?: string;
  presetName?: string; // defaults to 'trusted-default'
  // Optional adapter override (for tests). Production passes
  // ClaudeCodeLocalAdapter.
  adapter: ClaudeCodeLocalAdapter;
}

export interface SpawnAgentResult {
  cockpitAgentId: string;
  cockpitSessionId: string;
  cockpitWorkspaceId: string;
  worktreePath: string;
  branch: string;
}

export async function spawnAgentWithPolicy(args: SpawnAgentArgs): Promise<SpawnAgentResult> {
  const db = getCockpitDb();
  const presetName = args.presetName ?? 'trusted-default';

  const [project] = await db
    .select()
    .from(cockpitProjects)
    .where(eq(cockpitProjects.cockpitProjectId, args.cockpitProjectId))
    .limit(1);
  if (!project) throw new SpawnError(404, 'unknown cockpitProjectId');
  if (project.kind !== 'local-repo' || !project.repoPath) {
    throw new SpawnError(400, 'claude-code-local requires a local-repo project');
  }

  const worktree = await createWorktree({
    cockpitProjectId: args.cockpitProjectId,
    repoPath: project.repoPath,
    branch: args.branch,
    baseBranch: args.baseBranch,
  });

  const cockpitAgentId = generateCockpitAgentId();
  const cockpitSessionId = generateCockpitSessionId();
  const now = new Date().toISOString();

  await db.insert(cockpitAgents).values({
    cockpitAgentId,
    cockpitProjectId: args.cockpitProjectId,
    cockpitWorkspaceId: worktree.cockpitWorkspaceId,
    agentType: 'claude-code-local',
    label: args.label,
    capabilities: Array.from(args.adapter.capabilities),
    createdAt: now,
  });

  // Attach the autonomy preset to the new agent. Without this attachment
  // the gate logic falls back to 'ask' for everything — meaning even
  // routine 'allow' actions (read-files, run-tests) would surface as
  // queue cards. Attaching the preset is what gives per-stage autonomy
  // teeth.
  const preset = await db
    .select({
      capability: cockpitAutonomyPolicies.capability,
      stage: cockpitAutonomyPolicies.stage,
      level: cockpitAutonomyPolicies.level,
    })
    .from(cockpitAutonomyPolicies)
    .where(sql`preset_name = ${presetName}`);
  if (preset.length === 0) {
    throw new SpawnError(500, `autonomy preset '${presetName}' not seeded`);
  }
  await db.insert(cockpitAutonomyPolicies).values(
    preset.map((p) => ({
      cockpitAutonomyPolicyId: generateCockpitAutonomyPolicyId(),
      cockpitAgentId,
      presetName: null,
      capability: p.capability,
      stage: p.stage,
      level: p.level,
      createdAt: now,
      updatedAt: now,
    })),
  );

  await db.insert(cockpitSessions).values({
    cockpitSessionId,
    cockpitAgentId,
    cockpitProjectId: args.cockpitProjectId,
    state: 'queued',
    stage: args.stage,
    task: args.task,
    createdAt: now,
  });

  const session = await args.adapter.spawn({
    cockpitProjectId: args.cockpitProjectId,
    cockpitAgentId,
    cockpitSessionId,
    task: args.task,
    workingDirectory: worktree.worktreePath,
    branch: worktree.branch,
  });

  await db
    .update(cockpitSessions)
    .set({ externalId: session.externalId })
    .where(eq(cockpitSessions.cockpitSessionId, cockpitSessionId));

  return {
    cockpitAgentId,
    cockpitSessionId,
    cockpitWorkspaceId: worktree.cockpitWorkspaceId,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch,
  };
}

// Tiny error type so route handlers can map back to HTTP status codes
// without each one re-implementing the error→reply translation.
export class SpawnError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SpawnError';
  }
}
