// Unit-ish tests for lib/git-intel.ts.
//
// Spins up a real bare git repo + worktree under os.tmpdir, runs commits
// through it, and asserts what readSessionIntel reports back. We avoid
// mocking child_process — the value of git-intel IS its handling of
// real git output (numstat oddities, name-status renames, missing
// merge-base, etc), so a real git is the only honest fixture.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIntel } from '../src/lib/git-intel.js';

const exec = promisify(execFile);

interface Fixture {
  root: string;
  repoPath: string; // bare-ish source repo with main + agent branch
  worktreePath: string; // where the agent works
  branch: string;
}

async function runGit(cwd: string, args: string[]) {
  await exec('git', args, { cwd });
}

async function setupFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-gitintel-'));
  const repoPath = join(root, 'repo');
  const worktreePath = join(root, 'agent-wt');

  // Init source repo with a baseline commit on main.
  await mkdir(repoPath, { recursive: true });
  await runGit(repoPath, ['init', '--initial-branch=main']);
  await runGit(repoPath, ['config', 'user.email', 'test@cockpit.local']);
  await runGit(repoPath, ['config', 'user.name', 'Cockpit Test']);
  await runGit(repoPath, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repoPath, 'README.md'), 'baseline\n');
  await runGit(repoPath, ['add', '.']);
  await runGit(repoPath, ['commit', '-m', 'baseline']);

  // Create the agent's branch via worktree.
  const branch = 'cockpit/test-agent';
  await runGit(repoPath, ['worktree', 'add', '-b', branch, worktreePath]);
  // Same identity in the worktree; some git versions don't inherit local
  // config over a worktree boundary.
  await runGit(worktreePath, ['config', 'user.email', 'test@cockpit.local']);
  await runGit(worktreePath, ['config', 'user.name', 'Cockpit Test']);
  await runGit(worktreePath, ['config', 'commit.gpgsign', 'false']);

  return { root, repoPath, worktreePath, branch };
}

async function cleanup(f: Fixture | null) {
  if (!f) return;
  try {
    await runGit(f.repoPath, ['worktree', 'remove', '--force', f.worktreePath]);
  } catch {
    /* worktree may already be gone */
  }
  await rm(f.root, { recursive: true, force: true });
}

describe('git-intel', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await cleanup(f);
    f = null;
  });

  it('reports zero commits + zero changed files for a fresh worktree', async () => {
    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.commits).toHaveLength(0);
    expect(intel.changedFiles).toHaveLength(0);
    expect(intel.merged).toBe(true); // no commits past mergeBase = trivially merged
    expect(intel.mainBranch).toBe('main');
    expect(intel.branchHead).toBeTypeOf('string');
    expect(intel.mergeBase).toBeTypeOf('string');
  });

  it('captures cumulative changed files across multiple commits', async () => {
    await writeFile(join(f!.worktreePath, 'a.ts'), 'export const a = 1;\n');
    await runGit(f!.worktreePath, ['add', '.']);
    await runGit(f!.worktreePath, ['commit', '-m', 'feat: add a']);

    await writeFile(join(f!.worktreePath, 'b.ts'), 'export const b = 2;\n');
    await runGit(f!.worktreePath, ['add', '.']);
    await runGit(f!.worktreePath, ['commit', '-m', 'feat: add b']);

    // Touch a.ts in a second commit — it shouldn't appear twice in the
    // cumulative file list.
    await writeFile(join(f!.worktreePath, 'a.ts'), 'export const a = 1;\nexport const a2 = 1;\n');
    await runGit(f!.worktreePath, ['add', '.']);
    await runGit(f!.worktreePath, ['commit', '-m', 'feat: extend a']);

    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.commits).toHaveLength(3);
    const paths = intel.changedFiles.map((f) => f.path).sort();
    expect(paths).toEqual(['a.ts', 'b.ts']);
    const a = intel.changedFiles.find((f) => f.path === 'a.ts')!;
    expect(a.status).toBe('added');
    // First commit added 1 line, third added another → cumulative >= 2.
    expect(a.insertions).toBeGreaterThanOrEqual(2);
  });

  it('reports a deletion of a file that existed at base', async () => {
    // Pre-stage the source repo with a file present on main.
    await writeFile(join(f!.repoPath, 'will-delete.ts'), 'temp\n');
    await runGit(f!.repoPath, ['add', '.']);
    await runGit(f!.repoPath, ['commit', '-m', 'baseline + will-delete']);
    // Bring main into the worktree.
    await runGit(f!.worktreePath, ['merge', 'main']);
    // Now delete it on the agent branch.
    await runGit(f!.worktreePath, ['rm', 'will-delete.ts']);
    await runGit(f!.worktreePath, ['commit', '-m', 'drop will-delete']);

    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    const paths = intel.changedFiles.map((f) => f.path);
    expect(paths).toContain('will-delete.ts');
    const wd = intel.changedFiles.find((f) => f.path === 'will-delete.ts')!;
    expect(wd.status).toBe('deleted');
  });

  it('reports a rename with the new path', async () => {
    await writeFile(join(f!.worktreePath, 'before.ts'), 'export const x = 1;\n');
    await runGit(f!.worktreePath, ['add', '.']);
    await runGit(f!.worktreePath, ['commit', '-m', 'add before']);
    await runGit(f!.worktreePath, ['mv', 'before.ts', 'after.ts']);
    await runGit(f!.worktreePath, ['commit', '-m', 'rename before → after']);

    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    const paths = intel.changedFiles.map((f) => f.path);
    expect(paths).toContain('after.ts');
    expect(paths).not.toContain('before.ts');
    const after = intel.changedFiles.find((f) => f.path === 'after.ts')!;
    // git --name-status reports R (rename) when -M detection fires;
    // for a tiny file the threshold may fall short and report A (added).
    // Either reading is correct.
    expect(['renamed', 'added', 'modified']).toContain(after.status);
  });

  it('reports merged=true once the branch is merged into main', async () => {
    await writeFile(join(f!.worktreePath, 'm.ts'), 'export {};\n');
    await runGit(f!.worktreePath, ['add', '.']);
    await runGit(f!.worktreePath, ['commit', '-m', 'feat: m']);

    // Pre-merge: not yet on main.
    let intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.merged).toBe(false);
    expect(intel.commits).toHaveLength(1);

    // Merge into main from the source repo.
    await runGit(f!.repoPath, ['merge', '--no-ff', f!.branch, '-m', 'merge agent']);

    intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.merged).toBe(true);
  });

  it('returns an empty intel object when the worktree is missing', async () => {
    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: join(f!.root, 'does-not-exist'),
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.commits).toHaveLength(0);
    expect(intel.changedFiles).toHaveLength(0);
    expect(intel.branchHead).toBeNull();
    expect(intel.mergeBase).toBeNull();
  });

  it('falls back to master when no main branch exists', async () => {
    // Build a parallel repo whose default branch is master.
    const root = await mkdtemp(join(tmpdir(), 'cockpit-gitintel-master-'));
    const repoPath = join(root, 'repo');
    const worktreePath = join(root, 'wt');
    try {
      await mkdir(repoPath, { recursive: true });
      await runGit(repoPath, ['init', '--initial-branch=master']);
      await runGit(repoPath, ['config', 'user.email', 'test@cockpit.local']);
      await runGit(repoPath, ['config', 'user.name', 'Cockpit Test']);
      await runGit(repoPath, ['config', 'commit.gpgsign', 'false']);
      await writeFile(join(repoPath, 'README.md'), 'baseline\n');
      await runGit(repoPath, ['add', '.']);
      await runGit(repoPath, ['commit', '-m', 'baseline']);
      await runGit(repoPath, ['worktree', 'add', '-b', 'feat/x', worktreePath]);

      const intel = await readSessionIntel({
        cockpitSessionId: 'ckse_test',
        worktreePath,
        branch: 'feat/x',
        repoPath,
      });
      expect(intel.mainBranch).toBe('master');
    } finally {
      try {
        await runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
      } catch {
        /* ignore */
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not crash when gh is missing or branch has no PR', async () => {
    // We can't reliably mock PATH in this test runner; the production
    // code's behaviour when `gh pr view` fails is to return null. The
    // baseline repo has no remote, so even if gh exists locally it'll
    // return null. We assert on that null fall-through.
    const intel = await readSessionIntel({
      cockpitSessionId: 'ckse_test',
      worktreePath: f!.worktreePath,
      branch: f!.branch,
      repoPath: f!.repoPath,
    });
    expect(intel.pr).toBeNull();
  });
});
