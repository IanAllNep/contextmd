import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { updateContent, useStore } from '../store';

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-h1' },
  { tag: t.heading2, class: 'cm-h2' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], class: 'cm-h3' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], class: 'cm-md-link' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: [t.processingInstruction, t.meta, t.comment], class: 'cm-md-meta' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.list, class: 'cm-md-list' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { background: 'var(--bg)', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLineGutter': { background: 'transparent', color: 'var(--text-muted)' },
  '.cm-activeLine': { background: 'var(--active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: 'var(--selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-flash-line': { background: 'var(--flash)', transition: 'background 1s' },
});

/** Per-file editor state (undo history, selection) survives tab switches. */
const states = new Map<string, EditorState>();

export function Editor({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const currentPath = useRef(path);
  const content = useStore((s) => s.buffers[path]?.content ?? '');
  const navRequest = useStore((s) => s.navRequest);

  const makeState = (doc: string, p: string): EditorState => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      bracketMatching(),
      search({ top: true }),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      theme,
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) updateContent(p, u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const pos = u.state.selection.main.head;
          const line = u.state.doc.lineAt(pos);
          useStore.setState({ cursor: { line: line.number, col: pos - line.from + 1 } });
        }
      }),
    ];
    return EditorState.create({ doc, extensions });
  };

  // Create the view once.
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: states.get(path) ?? makeState(content, path),
    });
    view.current = v;
    return () => {
      states.set(currentPath.current, v.state);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch documents when the tab changes.
  useEffect(() => {
    const v = view.current;
    if (!v || currentPath.current === path) return;
    states.set(currentPath.current, v.state);
    currentPath.current = path;
    v.setState(states.get(path) ?? makeState(content, path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Apply content changes that came from outside the editor (reload from disk).
  useEffect(() => {
    const v = view.current;
    if (!v || currentPath.current !== path) return;
    const doc = v.state.doc.toString();
    if (doc !== content) {
      const head = Math.min(v.state.selection.main.head, content.length);
      v.dispatch({
        changes: { from: 0, to: doc.length, insert: content },
        selection: { anchor: head },
      });
    }
  }, [content, path]);

  // Scroll to a requested line (outline, search results, provenance).
  useEffect(() => {
    const v = view.current;
    if (!v || !navRequest || navRequest.path !== path) return;
    const lineNo = Math.max(1, Math.min(navRequest.line, v.state.doc.lines));
    const line = v.state.doc.line(lineNo);
    v.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 48 }),
    });
    v.focus();
  }, [navRequest, path]);

  // Forget cached states for closed tabs.
  const tabs = useStore((s) => s.tabs);
  useEffect(() => {
    for (const p of states.keys()) if (!tabs.includes(p)) states.delete(p);
  }, [tabs]);

  return <div className="editor-host" ref={host} />;
}
