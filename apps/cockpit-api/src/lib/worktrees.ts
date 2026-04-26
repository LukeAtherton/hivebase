import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { eq } from 'drizzle-orm';
import { getCockpitDb, cockpitWorkspaces } from '@kybernos/platform';
import { generateCockpitWorkspaceId } from '@kybernos/ids';

const exec = promisify(execFile);

export interface CreatedWorktree {
  cockpitWorkspaceId: string;
  worktreePath: string;
  branch: string;
}

export interface CreateWorktreeOpts {
  cockpitProjectId: string;
  repoPath: string; // absolute path to the source repo
  branch?: string; // default: cockpit/{ulid-suffix}
  baseBranch?: string; // default: HEAD
}

// Worktrees live under ~/.cockpit-worktrees/{repo-name}/{ulid}.
// Keeps them off the repo's own filesystem so rm -rf is safe.
const WORKTREE_ROOT = join(homedir(), '.cockpit-worktrees');

export async function createWorktree(opts: CreateWorktreeOpts): Promise<CreatedWorktree> {
  const cockpitWorkspaceId = generateCockpitWorkspaceId();
  const repoPath = resolve(opts.repoPath);
  const repoName = repoPath.split('/').filter(Boolean).pop() ?? 'repo';
  const worktreePath = join(WORKTREE_ROOT, repoName, cockpitWorkspaceId);
  const branch =
    opts.branch ??
    `cockpit/${cockpitWorkspaceId
      .replace(/^ckws_/, '')
      .slice(-8)
      .toLowerCase()}`;

  await mkdir(dirname(worktreePath), { recursive: true });

  const args = ['worktree', 'add', '-b', branch, worktreePath];
  if (opts.baseBranch) args.push(opts.baseBranch);

  await exec('git', args, { cwd: repoPath });

  const now = new Date().toISOString();
  await getCockpitDb().insert(cockpitWorkspaces).values({
    cockpitWorkspaceId,
    cockpitProjectId: opts.cockpitProjectId,
    kind: 'worktree',
    worktreePath,
    branch,
    status: 'active',
    createdAt: now,
  });

  return { cockpitWorkspaceId, worktreePath, branch };
}

export async function removeWorktree(cockpitWorkspaceId: string): Promise<void> {
  const db = getCockpitDb();
  const [ws] = await db
    .select()
    .from(cockpitWorkspaces)
    .where(eq(cockpitWorkspaces.cockpitWorkspaceId, cockpitWorkspaceId))
    .limit(1);
  if (!ws || ws.kind !== 'worktree' || !ws.worktreePath) return;

  // Best-effort: git worktree remove --force (handles uncommitted state).
  // Project we worktreed from is not stored on the row; derive from the
  // worktree's own .git file, which points back at the main repo.
  try {
    await exec('git', ['worktree', 'remove', '--force', ws.worktreePath]);
  } catch {
    // Fall through to fs cleanup if git already lost track.
    await rm(ws.worktreePath, { recursive: true, force: true });
  }

  await db
    .update(cockpitWorkspaces)
    .set({ status: 'removed', removedAt: new Date().toISOString() })
    .where(eq(cockpitWorkspaces.cockpitWorkspaceId, cockpitWorkspaceId));
}
