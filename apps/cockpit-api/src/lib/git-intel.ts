// Git intelligence for the territory map.
//
// Given a session, return:
//   - commits authored on its branch since divergence from main
//   - cumulative changed files across those commits (one entry per
//     unique path) — this drives the territory: one tile per file
//   - merge status: have these commits made it onto main yet
//   - PR status (optional): if `gh` is on PATH and the branch was
//     pushed, return the PR's number/state/URL. Otherwise null.
//
// All lookups are local-only against the worktree + main repo. PR is
// the one network call and it's strictly best-effort — failure here
// does NOT fail the whole intel response.
//
// This module is intentionally side-effect-free. The caller decides
// when to poll (see ../routes/territory.ts and the WS push loop).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';

const exec = promisify(execFile);

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  authoredAt: string; // ISO
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ChangedFile {
  path: string;
  // 'A' | 'M' | 'D' | 'R' | 'C' — git's name-status code, simplified.
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'other';
  // Cumulative line-counts across all the agent's commits that touch
  // this file. Use these to size/colour the tile if we want to show
  // "how much work landed here".
  insertions: number;
  deletions: number;
}

export interface PrStatus {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  isDraft: boolean;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'COMMENTED' | null;
}

export interface SessionIntel {
  cockpitSessionId: string;
  branch: string;
  worktreePath: string;
  // Resolved name of the project's "main" branch. We probe in this
  // order: configured project default → 'main' → 'master'. Falls back
  // to 'main' literal if neither exists in the source repo.
  mainBranch: string;
  // sha of the branch's tip and the merge-base against main.
  branchHead: string | null;
  mergeBase: string | null;
  // True iff every commit authored on this branch is reachable from
  // main (i.e. the work has merged). This is what triggers the
  // tile-redistribution animation in the UI.
  merged: boolean;
  commits: GitCommit[];
  changedFiles: ChangedFile[];
  pr: PrStatus | null;
  // Last-modified timestamp of the worktree dir as a coarse staleness
  // signal — used downstream to surface "this branch hasn't moved in
  // a long time" without firing extra git commands.
  worktreeModifiedAt: string | null;
}

interface IntelArgs {
  cockpitSessionId: string;
  worktreePath: string;
  branch: string;
  // Source repo (the project's repoPath). Where main lives. Worktrees
  // are derived from this; merge-base lookups go here.
  repoPath: string;
}

export async function readSessionIntel(args: IntelArgs): Promise<SessionIntel> {
  const { cockpitSessionId, worktreePath, branch, repoPath } = args;

  // Worktree may have been removed (cleanup, manual rm). Guard so we
  // can still answer with a sensible empty intel — UI should handle
  // "agent has no territory yet".
  const worktreeExists = await pathExists(worktreePath);
  const repoExists = await pathExists(repoPath);

  let mainBranch = await resolveMainBranch(repoPath);
  if (!mainBranch) mainBranch = 'main';

  const empty: SessionIntel = {
    cockpitSessionId,
    branch,
    worktreePath,
    mainBranch,
    branchHead: null,
    mergeBase: null,
    merged: false,
    commits: [],
    changedFiles: [],
    pr: null,
    worktreeModifiedAt: null,
  };

  if (!worktreeExists || !repoExists) return empty;

  let branchHead: string | null = null;
  let mergeBase: string | null = null;

  try {
    branchHead = (await exec('git', ['rev-parse', branch], { cwd: repoPath })).stdout.trim();
  } catch {
    // Branch doesn't exist in source repo (worktree might be the only
    // place it lives). Try the worktree itself.
    try {
      branchHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })).stdout.trim();
    } catch {
      return empty;
    }
  }

  try {
    mergeBase = (
      await exec('git', ['merge-base', branchHead!, mainBranch], { cwd: repoPath })
    ).stdout.trim();
  } catch {
    // No merge-base: branch and main are unrelated histories. Treat as
    // unmerged with no commits.
    mergeBase = null;
  }

  const merged = branchHead && mainBranch
    ? await isAncestor(branchHead, mainBranch, repoPath)
    : false;

  // Commits authored on the branch since divergence (mergeBase..head).
  const commits = mergeBase
    ? await readCommits(repoPath, `${mergeBase}..${branchHead}`)
    : [];

  // Cumulative changed files via git diff --numstat against the merge-base.
  const changedFiles = mergeBase
    ? await readChangedFiles(repoPath, mergeBase!, branchHead!)
    : [];

  // PR is best-effort. If gh isn't on PATH or the branch isn't pushed,
  // we just return null. Don't let it slow the whole intel call.
  const pr = await readPrStatus(repoPath, branch).catch(() => null);

  const worktreeModifiedAt = await pathMtime(worktreePath);

  return {
    cockpitSessionId,
    branch,
    worktreePath,
    mainBranch,
    branchHead,
    mergeBase,
    merged,
    commits,
    changedFiles,
    pr,
    worktreeModifiedAt,
  };
}

// --- helpers --------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function pathMtime(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    return s.mtime.toISOString();
  } catch {
    return null;
  }
}

async function resolveMainBranch(repoPath: string): Promise<string | null> {
  // Check 'main' then 'master'. Don't resolve from origin/HEAD — works
  // even when the repo isn't pushed to a remote.
  for (const candidate of ['main', 'master']) {
    try {
      await exec('git', ['rev-parse', '--verify', candidate], { cwd: repoPath });
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function isAncestor(sha: string, ref: string, cwd: string): Promise<boolean> {
  try {
    await exec('git', ['merge-base', '--is-ancestor', sha, ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function readCommits(cwd: string, range: string): Promise<GitCommit[]> {
  // We list commits without --shortstat: the cumulative file diff
  // already carries line counts (readChangedFiles) which is what the
  // territory map uses. Per-commit ins/del would require a state-
  // machine parse around \x1e records that's brittle; we keep this
  // call bone-simple. filesChanged/ins/del default to 0 — fine for
  // the territory consumer.
  const fmt = ['%H', '%h', '%aI', '%s'].join('%x1f');
  let stdout: string;
  try {
    stdout = (
      await exec('git', ['log', `--format=${fmt}`, range], {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout;
  } catch {
    return [];
  }

  const out: GitCommit[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [sha, shortSha, authoredAt, ...messageParts] = line.split('\x1f');
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const message = messageParts.join('\x1f') ?? '';
    out.push({
      sha,
      shortSha,
      message,
      authoredAt,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  }
  return out;
}

async function readChangedFiles(
  cwd: string,
  base: string,
  head: string,
): Promise<ChangedFile[]> {
  // numstat gives ins/del per file. name-status gives A/M/D/R/C codes.
  // Run both in parallel and merge by path.
  const [num, names] = await Promise.all([
    exec('git', ['diff', '--numstat', `${base}..${head}`], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(() => ({ stdout: '' })),
    exec('git', ['diff', '--name-status', `${base}..${head}`], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(() => ({ stdout: '' })),
  ]);

  const stats = new Map<string, { ins: number; del: number }>();
  for (const line of num.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [insStr, delStr, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    if (!path) continue;
    // Binary files show '-' in numstat; treat as 0.
    const ins = insStr === '-' ? 0 : Number(insStr) || 0;
    const del = delStr === '-' ? 0 : Number(delStr) || 0;
    stats.set(path, { ins, del });
  }

  const out: ChangedFile[] = [];
  for (const line of names.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [code, ...pathParts] = line.split('\t');
    // Renames look like "R092\told\tnew" — keep the new path, mark renamed.
    let path: string;
    let status: ChangedFile['status'];
    const head = code?.[0] ?? '?';
    if (head === 'R' || head === 'C') {
      // pathParts[0] is old, pathParts[1] is new
      path = pathParts[1] ?? pathParts[0] ?? '';
      status = head === 'R' ? 'renamed' : 'modified';
    } else {
      path = pathParts.join('\t');
      status =
        head === 'A' ? 'added' : head === 'M' ? 'modified' : head === 'D' ? 'deleted' : 'other';
    }
    if (!path) continue;
    const s = stats.get(path) ?? { ins: 0, del: 0 };
    out.push({ path, status, insertions: s.ins, deletions: s.del });
  }
  return out;
}

// Unified diff for a single file on the agent's branch (mergeBase..head).
// Returns the raw `git diff` output the UI will syntax-highlight.
// Empty string = no changes / unknown branch / file not in diff.
export async function readFileDiff(args: {
  repoPath: string;
  branch: string;
  filePath: string;
}): Promise<string> {
  const { repoPath, branch, filePath } = args;
  let mainBranch = await resolveMainBranch(repoPath);
  if (!mainBranch) mainBranch = 'main';
  let mergeBase: string;
  let head: string;
  try {
    head = (await exec('git', ['rev-parse', branch], { cwd: repoPath })).stdout.trim();
    mergeBase = (
      await exec('git', ['merge-base', head, mainBranch], { cwd: repoPath })
    ).stdout.trim();
  } catch {
    return '';
  }
  try {
    const out = await exec(
      'git',
      ['diff', `${mergeBase}..${head}`, '--', filePath],
      { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 },
    );
    return out.stdout;
  } catch {
    return '';
  }
}

async function readPrStatus(repoPath: string, branch: string): Promise<PrStatus | null> {
  // gh is the only network-touching call here. Fail open: if gh isn't
  // installed, isn't authenticated, or the branch isn't on a remote
  // with an associated PR, just return null.
  let stdout: string;
  try {
    stdout = (
      await exec(
        'gh',
        [
          'pr',
          'view',
          branch,
          '--json',
          'number,state,url,isDraft,reviewDecision',
        ],
        { cwd: repoPath, timeout: 4_000 },
      )
    ).stdout;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout) as PrStatus;
    return parsed;
  } catch {
    return null;
  }
}
