import { isAgentKind } from '../lib/tree';
import { displayPath, fmtTokens } from '../lib/format';
import { CONTEXT_TAB, isDirty, useStore } from '../store';
import { showEffectiveContext } from '../commands';

export function StatusBar() {
  const snapshot = useStore((s) => s.snapshot);
  const context = useStore((s) => s.context);
  const adapterId = useStore((s) => s.adapterId);
  const cursor = useStore((s) => s.cursor);
  const activeTab = useStore((s) => s.activeTab);
  const dirtyCount = useStore((s) => Object.values(s.buffers).filter(isDirty).length);
  const indexing = useStore((s) => s.indexing);
  if (!snapshot) return <footer className="statusbar" />;
  const agent = snapshot.files.filter((f) => isAgentKind(f.kind)).length;
  const adapter = snapshot.adapters.find((a) => a.id === adapterId);
  return (
    <footer className="statusbar">
      <span>{snapshot.files.length} Markdown files</span>
      <span>{agent} agent-facing</span>
      {snapshot.scanTruncated && (
        <span className="warn" title="The repository is very large; scanning stopped early">
          scan truncated
        </span>
      )}
      {indexing && (
        <span>
          Indexing {indexing.done}/{indexing.total}…
        </span>
      )}
      <button className="status-link" onClick={showEffectiveContext} title="Show effective context">
        {adapter?.name ?? adapterId} · {context ? displayPath(context.resolved.target.cwd) : '…'} ·
        ~{fmtTokens(context?.resolved.totals.tokens ?? 0)} tokens (est.)
      </button>
      {context && context.diagnostics.length > 0 && (
        <span className="warn">{context.diagnostics.length} diagnostics</span>
      )}
      <span className="spacer" />
      {dirtyCount > 0 && <span className="warn">{dirtyCount} unsaved</span>}
      {activeTab && activeTab !== CONTEXT_TAB && cursor && (
        <span>
          Ln {cursor.line}, Col {cursor.col}
        </span>
      )}
      <span className="muted">Markdown</span>
    </footer>
  );
}
