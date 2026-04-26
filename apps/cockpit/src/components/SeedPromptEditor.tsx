// Lightweight markdown editor for the scoping seed prompt.
//
// LazyVim-style: raw markdown text shown as-is, syntax tokens tinted
// in place (no live preview pane, no WYSIWYG). Built on CodeMirror 6
// with the markdown grammar.
//
// Drag-and-drop or paste an image and we POST it to /scope/uploads,
// then insert ![alt](abs/path) at the caret. The absolute path is what
// the spawned implementation agent ultimately reads off disk.

import { useCallback, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { api } from '../lib/api';

// Hand-tuned theme keyed to the cockpit palette (panel, accent, muted).
// Kept small on purpose: tints headings, emphasis, code, links, lists.
const cockpitHighlight = HighlightStyle.define([
  // Palette pinned to the cockpit's tailwind tokens:
  //   accent  = #7dd3fc (sky blue, headings/links)
  //   text    = #cbd5df (default body)
  //   muted   = #5a6573 (meta, urls, quotes)
  //   ok      = #22c55e (inline code/monospace)
  //   warn    = #f59e0b (lists, slight emphasis)
  //   alarm   = #ef4444 (reserved for errors — not used here)
  { tag: t.heading1, color: '#7dd3fc', fontWeight: '600' },
  { tag: t.heading2, color: '#7dd3fc' },
  { tag: t.heading3, color: '#7dd3fc' },
  { tag: t.heading4, color: '#7dd3fc' },
  { tag: t.strong, color: '#cbd5df', fontWeight: '600' },
  { tag: t.emphasis, color: '#cbd5df', fontStyle: 'italic' },
  { tag: t.link, color: '#7dd3fc', textDecoration: 'underline' },
  { tag: t.url, color: '#5a6573' },
  { tag: t.monospace, color: '#22c55e' },
  { tag: t.list, color: '#f59e0b' },
  { tag: t.quote, color: '#5a6573', fontStyle: 'italic' },
  { tag: t.meta, color: '#5a6573' },
  { tag: t.processingInstruction, color: '#5a6573' },
]);

const cockpitTheme = EditorView.theme(
  {
    // Outer .cm-editor: transparent (the wrapping div carries the
    // bg-ink/40 we want), full-height. Without `dark: true` on the
    // theme below CodeMirror would default to a light surface which
    // leaks through any pixel we don't explicitly paint.
    '&': {
      backgroundColor: 'transparent',
      color: '#cbd5df',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: '12.5px',
    },
    '.cm-scroller': {
      backgroundColor: 'transparent',
      fontFamily: 'inherit',
      lineHeight: '1.55',
      // Always-visible thin scrollbar styled to match the cockpit
      // chrome. Default macOS Chrome auto-hides; explicit thin styling
      // keeps the affordance present so the user can see overflow.
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(125,211,252,0.35) transparent',
    },
    '.cm-scroller::-webkit-scrollbar': {
      width: '8px',
      height: '8px',
    },
    '.cm-scroller::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      background: 'rgba(125,211,252,0.25)',
      borderRadius: '4px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      background: 'rgba(125,211,252,0.5)',
    },
    '.cm-content': {
      backgroundColor: 'transparent',
      caretColor: '#7dd3fc',
      padding: '12px 14px',
    },
    '.cm-line': { padding: '0', backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#7dd3fc' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(125,211,252,0.25)',
    },
    '.cm-placeholder': { color: '#5a6573', fontStyle: 'italic' },
  },
  // Mark the theme as dark — without this CodeMirror's internal
  // base styles fall back to the light preset (white background on
  // .cm-content etc). Combined with the @uiw/react-codemirror
  // theme="dark" prop being removed, this is the only flag telling
  // CM to use its dark base.
  { dark: true },
);

export interface SeedPromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  artifactId?: string;
  placeholder?: string;
}

export function SeedPromptEditor({
  value,
  onChange,
  artifactId,
  placeholder,
}: SeedPromptEditorProps) {
  const ref = useRef<ReactCodeMirrorRef | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const insertAtCaret = useCallback((text: string) => {
    const view = ref.current?.view;
    if (!view) return;
    const from = view.state.selection.main.from;
    const to = view.state.selection.main.to;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }, []);

  const uploadAndInsert = useCallback(
    async (file: File) => {
      setError(null);
      setUploading((n) => n + 1);
      try {
        const result = await api.uploadScopeImage(file, artifactId);
        const alt = file.name.replace(/\.[^.]+$/, '');
        insertAtCaret(`\n![${alt}](${result.path})\n`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    },
    [artifactId, insertAtCaret],
  );

  // CM6 has its own drop handling — we tap into it via an EditorView
  // domEventHandler. Same for paste, so a screenshot from the clipboard
  // becomes an upload+insert.
  const dndExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        drop(event) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
          if (images.length === 0) return false;
          event.preventDefault();
          for (const f of images) void uploadAndInsert(f);
          return true;
        },
        paste(event) {
          const items = event.clipboardData?.items;
          if (!items) return false;
          let handled = false;
          for (const item of Array.from(items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              const f = item.getAsFile();
              if (f) {
                handled = true;
                void uploadAndInsert(f);
              }
            }
          }
          if (handled) event.preventDefault();
          return handled;
        },
      }),
    [uploadAndInsert],
  );

  // Wrap our highlight + theme in Prec.highest so they beat the
  // @uiw/react-codemirror theme="dark" preset (which injects its own
  // syntax highlight + theme — without this the preset's pink
  // headings override our cockpit palette).
  const extensions = useMemo(
    () => [
      markdown(),
      Prec.highest(syntaxHighlighting(cockpitHighlight)),
      Prec.highest(cockpitTheme),
      dndExtension,
    ],
    [dndExtension],
  );

  return (
    <div className="relative h-full overflow-hidden rounded border border-border bg-ink/40">
      <CodeMirror
        ref={ref}
        value={value}
        onChange={onChange}
        extensions={extensions}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
        }}
        theme="dark"
        height="100%"
      />
      {(uploading > 0 || error) && (
        <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col items-end gap-1">
          {uploading > 0 && (
            <div className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
              uploading {uploading}…
            </div>
          )}
          {error && (
            <div className="rounded border border-alarm/40 bg-alarm/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-alarm">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
