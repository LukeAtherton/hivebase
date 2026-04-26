// Pure unit test for territory-poller's shape-hash dedup. The poller
// only emits 'territory-updated' when shapeOf(intel) differs from the
// last seen value; this test pins the equivalence relation it uses
// (commit count + branch head + merged flag + pr state + sorted file
// paths). Anything beyond that (timestamps, line counts) is meant to
// be a no-op for the bus — confirming that here keeps the WS quiet
// when nothing real has happened.

import { describe, expect, it } from 'vitest';
import { shapeOf } from '../src/lib/territory-poller.js';
import type { SessionIntel } from '../src/lib/git-intel.js';

function intel(overrides: Partial<SessionIntel> = {}): SessionIntel {
  return {
    cockpitSessionId: 'ckse_test',
    branch: 'cockpit/test',
    worktreePath: '/tmp/wt',
    mainBranch: 'main',
    branchHead: 'sha-1',
    mergeBase: 'base-1',
    merged: false,
    commits: [],
    changedFiles: [],
    pr: null,
    worktreeModifiedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('shapeOf', () => {
  it('is stable for identical inputs', () => {
    const a = intel();
    const b = intel();
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });

  it('ignores worktree mtime', () => {
    const a = intel({ worktreeModifiedAt: '2026-01-01T00:00:00Z' });
    const b = intel({ worktreeModifiedAt: '2026-12-31T23:59:59Z' });
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });

  it('ignores cumulative line counts on individual files', () => {
    const a = intel({
      changedFiles: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 0 }],
    });
    const b = intel({
      changedFiles: [{ path: 'a.ts', status: 'modified', insertions: 999, deletions: 50 }],
    });
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });

  it('changes when a new file appears', () => {
    const a = intel({
      changedFiles: [{ path: 'a.ts', status: 'modified', insertions: 0, deletions: 0 }],
    });
    const b = intel({
      changedFiles: [
        { path: 'a.ts', status: 'modified', insertions: 0, deletions: 0 },
        { path: 'b.ts', status: 'added', insertions: 0, deletions: 0 },
      ],
    });
    expect(shapeOf(a)).not.toEqual(shapeOf(b));
  });

  it('is stable across reordering of files (sorted internally)', () => {
    const a = intel({
      changedFiles: [
        { path: 'a.ts', status: 'modified', insertions: 0, deletions: 0 },
        { path: 'b.ts', status: 'added', insertions: 0, deletions: 0 },
      ],
    });
    const b = intel({
      changedFiles: [
        { path: 'b.ts', status: 'added', insertions: 0, deletions: 0 },
        { path: 'a.ts', status: 'modified', insertions: 0, deletions: 0 },
      ],
    });
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });

  it('changes on merge transition', () => {
    const a = intel({ merged: false });
    const b = intel({ merged: true });
    expect(shapeOf(a)).not.toEqual(shapeOf(b));
  });

  it('changes when the branch head sha advances', () => {
    const a = intel({ branchHead: 'aaa', commits: [makeCommit('aaa')] });
    const b = intel({ branchHead: 'bbb', commits: [makeCommit('aaa'), makeCommit('bbb')] });
    expect(shapeOf(a)).not.toEqual(shapeOf(b));
  });

  it('changes on PR state transition', () => {
    const a = intel({ pr: null });
    const b = intel({
      pr: {
        number: 42,
        state: 'OPEN',
        url: 'https://github.com/x/y/pull/42',
        isDraft: false,
        reviewDecision: null,
      },
    });
    expect(shapeOf(a)).not.toEqual(shapeOf(b));
  });
});

function makeCommit(sha: string) {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: 'm',
    authoredAt: '2026-01-01T00:00:00Z',
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
  };
}
