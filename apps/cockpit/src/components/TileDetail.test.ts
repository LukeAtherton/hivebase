// Tests for the diff parser used by TileDetail. The renderer relies
// on parseDiff to classify each line (hunk header, meta, +/-/context)
// so coloured backgrounds and gutters land on the right lines.

import { describe, expect, it } from 'vitest';
import { parseDiff } from './TileDetail.js';

describe('parseDiff', () => {
  it('returns empty for an empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('classifies hunk headers', () => {
    const out = parseDiff('@@ -1,4 +1,5 @@');
    expect(out).toEqual([{ kind: 'hunk', text: '@@ -1,4 +1,5 @@' }]);
  });

  it('classifies meta lines (diff/index/+++/---)', () => {
    const text = [
      'diff --git a/x b/x',
      'index abc..def 100644',
      '--- a/x',
      '+++ b/x',
    ].join('\n');
    const out = parseDiff(text);
    expect(out.every((l) => l.kind === 'meta')).toBe(true);
  });

  it('strips the leading + or - from added/removed lines', () => {
    const text = ['+added line', '-removed line', ' context line'].join('\n');
    const out = parseDiff(text);
    expect(out).toEqual([
      { kind: '+', text: 'added line' },
      { kind: '-', text: 'removed line' },
      { kind: ' ', text: 'context line' },
    ]);
  });

  it('treats unmarked lines as context', () => {
    const out = parseDiff('plain unmarked\nanother line');
    expect(out.map((l) => l.kind)).toEqual([' ', ' ']);
  });

  it('keeps blank lines as empty context (no parsing weirdness)', () => {
    const out = parseDiff('\n\n');
    expect(out).toHaveLength(3);
    expect(out.every((l) => l.kind === ' ')).toBe(true);
    expect(out.every((l) => l.text === '')).toBe(true);
  });

  it('classifies a typical unified diff end-to-end', () => {
    const text = [
      'diff --git a/foo.ts b/foo.ts',
      'index abc..def 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
    ].join('\n');
    const out = parseDiff(text);
    const kinds = out.map((l) => l.kind);
    expect(kinds).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', ' ', '-', '+', '+']);
    // The leading marker is stripped from + / - lines.
    expect(out[6].text).toBe('const b = 2;');
    expect(out[7].text).toBe('const b = 3;');
  });

  it('classifies binary / rename / similarity headers as meta', () => {
    const text = [
      'similarity index 92%',
      'rename from old.ts',
      'rename to new.ts',
      'Binary files a/x.png and b/x.png differ',
    ].join('\n');
    const out = parseDiff(text);
    expect(out.every((l) => l.kind === 'meta')).toBe(true);
  });
});
