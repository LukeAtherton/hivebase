// Tile-detail panel — opens when an operator clicks a claimed terrain
// tile. Shows the file path, the cumulative diff for that file on the
// agent's branch, and the parent session's PR status.
//
// Diff styling: GitHub-style + / - line backgrounds in dark cyberpunk
// palette (sharp greens/reds, deep ink background). On top of that we
// do lightweight regex-based JS/TS keyword tinting — no shiki/treesitter,
// just enough to tell punctuation/strings/keywords apart at a glance.
//
// Coexists with SessionDetail. If both panels are open (selected agent
// + selected tile), they stack — TileDetail takes the right-of-detail
// slot; if only TileDetail is open it docks against the right edge.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type ChangedFile, type SessionIntel } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

interface Props {
  cockpitSessionId: string;
  filePath: string;
  // Width is set by the parent; the panel fills its allotted column.
}

export function TileDetail({ cockpitSessionId, filePath }: Props) {
  const setSelectedTile = useCockpitStore((s) => s.setSelectedTile);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTile(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedTile]);

  const territoryQ = useQuery({
    queryKey: ['session-territory', cockpitSessionId],
    queryFn: () => api.getSessionTerritory(cockpitSessionId),
  });
  const diffQ = useQuery({
    queryKey: ['session-diff', cockpitSessionId, filePath],
    queryFn: () => api.getSessionFileDiff(cockpitSessionId, filePath),
  });

  const intel = territoryQ.data as SessionIntel | undefined;
  const fileEntry: ChangedFile | undefined = intel?.changedFiles.find(
    (f) => f.path === filePath,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-gradient-to-b from-[#1a0030]/40 to-transparent px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-fuchsia-400/80">
            ▸ tile · file
          </div>
          <div
            className="mt-1 truncate font-display text-[15px] uppercase leading-tight tracking-[0.06em] text-text"
            title={filePath}
          >
            {filePath}
          </div>
          <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {fileEntry && (
              <>
                <FileStatusBadge status={fileEntry.status} />
                <span className="text-emerald-400">+{fileEntry.insertions}</span>
                <span className="text-rose-400">−{fileEntry.deletions}</span>
              </>
            )}
            {intel?.pr && <PrBadge state={intel.pr.state} url={intel.pr.url} />}
          </div>
        </div>
        <button
          onClick={() => setSelectedTile(null)}
          className="text-muted hover:text-text"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Diff body */}
      <div className="flex-1 overflow-auto bg-[#06060c]">
        {diffQ.isLoading ? (
          <div className="p-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            ··· loading diff
          </div>
        ) : diffQ.isError ? (
          <div className="p-6 font-mono text-[11px] text-alarm">
            ▲ failed to load diff
          </div>
        ) : !diffQ.data?.diff ? (
          <div className="p-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            no changes
          </div>
        ) : (
          <DiffView diff={diffQ.data.diff} />
        )}
      </div>
    </div>
  );
}

function FileStatusBadge({ status }: { status: ChangedFile['status'] }) {
  const map: Record<ChangedFile['status'], { label: string; cls: string }> = {
    added: { label: 'A', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' },
    modified: { label: 'M', cls: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300' },
    deleted: { label: 'D', cls: 'border-rose-500/50 bg-rose-500/10 text-rose-400' },
    renamed: { label: 'R', cls: 'border-fuchsia-400/50 bg-fuchsia-400/10 text-fuchsia-300' },
    other: { label: '·', cls: 'border-border bg-ink/40 text-muted' },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={clsx(
        'rounded-sm border px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em]',
        cls,
      )}
    >
      {label}
    </span>
  );
}

function PrBadge({ state, url }: { state: string; url: string }) {
  const cls =
    state === 'OPEN'
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
      : state === 'MERGED'
        ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300'
        : 'border-border bg-ink/40 text-muted';
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        'rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em] hover:text-text',
        cls,
      )}
    >
      pr · {state.toLowerCase()}
    </a>
  );
}

// --- Diff renderer -------------------------------------------------------

export interface DiffLine {
  kind: '+' | '-' | ' ' | 'hunk' | 'meta';
  text: string;
}

// Exported for tests. Parses unified-diff text into typed lines so the
// renderer can colour each one without re-parsing per row.
export function parseDiff(diff: string): DiffLine[] {
  if (!diff) return [];
  const out: DiffLine[] = [];
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      out.push({ kind: 'hunk', text: raw });
    } else if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('rename ') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('Binary files')
    ) {
      out.push({ kind: 'meta', text: raw });
    } else if (raw.startsWith('+')) {
      out.push({ kind: '+', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      out.push({ kind: '-', text: raw.slice(1) });
    } else {
      out.push({ kind: ' ', text: raw.startsWith(' ') ? raw.slice(1) : raw });
    }
  }
  return out;
}

function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  return (
    <pre className="m-0 font-mono text-[11.5px] leading-[1.55]">
      {lines.map((line, i) => (
        <DiffLineRow key={i} line={line} />
      ))}
    </pre>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <div className="border-y border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-300">
        {line.text}
      </div>
    );
  }
  if (line.kind === 'meta') {
    return (
      <div className="px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-500/70">
        {line.text}
      </div>
    );
  }
  // +, -, or context.
  const bg =
    line.kind === '+'
      ? 'bg-emerald-500/[0.07] border-l-2 border-l-emerald-400'
      : line.kind === '-'
        ? 'bg-rose-500/[0.08] border-l-2 border-l-rose-400'
        : 'border-l-2 border-l-transparent';
  const gutterColour =
    line.kind === '+' ? 'text-emerald-400' : line.kind === '-' ? 'text-rose-400' : 'text-muted';
  return (
    <div className={clsx('flex px-3', bg)}>
      <span className={clsx('mr-3 w-3 shrink-0 select-none text-right', gutterColour)}>
        {line.kind === ' ' ? '' : line.kind}
      </span>
      <span className="whitespace-pre-wrap break-words text-text/90">
        <SyntaxHighlighted text={line.text} />
      </span>
    </div>
  );
}

// --- Lightweight regex syntax tint --------------------------------------
//
// A real parser is overkill here. We tag a few obvious tokens:
//   - Strings (single, double, backtick) → cyan
//   - Line/block comments → muted italic
//   - Reserved words from a fixed set → fuchsia
//   - Numbers → amber
// Everything else stays default text. Works adequately for JS/TS/JSON/MD;
// other languages just get unstyled text, which is fine.

const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'break',
  'continue',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'enum',
  'import',
  'export',
  'from',
  'as',
  'default',
  'async',
  'await',
  'new',
  'this',
  'super',
  'null',
  'undefined',
  'true',
  'false',
  'try',
  'catch',
  'finally',
  'throw',
  'switch',
  'case',
  'in',
  'of',
  'typeof',
  'instanceof',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
]);

// Regex chooses a single token at a time. Order matters: comments and
// strings before identifiers so '//' and '"foo"' aren't misread.
const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b|[^\w\s])/g;

function SyntaxHighlighted({ text }: { text: string }) {
  if (!text) return <>&nbsp;</>;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    const tok = m[0];
    out.push(<TokenSpan key={`${m.index}`} token={tok} />);
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return <>{out}</>;
}

function TokenSpan({ token }: { token: string }) {
  // Comments
  if (token.startsWith('//') || token.startsWith('/*')) {
    return <span className="italic text-muted/80">{token}</span>;
  }
  // Strings
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith('`') && token.endsWith('`'))
  ) {
    return <span className="text-cyan-300">{token}</span>;
  }
  // Numbers
  if (/^\d/.test(token)) {
    return <span className="text-amber-300">{token}</span>;
  }
  // Keywords
  if (KEYWORDS.has(token)) {
    return <span className="text-fuchsia-300">{token}</span>;
  }
  return <>{token}</>;
}
