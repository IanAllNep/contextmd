import { isAgentKind } from '../lib/tree';
import { displayPath, fmtTokens } from '../lib/format';
import { openFile, useStore } from '../store';
import { Icon } from './Icon';

/** Shown in the center when no file is open: what agent-related Markdown exists here. */
export function RepoOverview() {
  const snapshot = useStore((s) => s.snapshot);
  if (!snapshot) return null;
  const agentFiles = snapshot.files.filter((f) => isAgentKind(f.kind));
  const tokens = agentFiles.reduce((n, f) => n + (f.stats?.tokens ?? 0), 0);
  const detected = snapshot.adapters.filter((a) => a.detected && a.id !== 'generic');
  return (
    <div className="overview">
      <h2>{snapshot.name}</h2>
      <p className="muted">
        {snapshot.files.length} Markdown files · {agentFiles.length} agent-facing · ~
        {fmtTokens(tokens)} tokens of agent Markdown (estimate)
      </p>
      {detected.length > 0 && (
        <p className="muted">Harness conventions found: {detected.map((a) => a.name).join(', ')}</p>
      )}
      {agentFiles.length === 0 ? (
        <p>
          No AGENTS.md, CLAUDE.md, rules or skills were found. You can still browse and search all
          Markdown on the left.
        </p>
      ) : (
        <ul className="overview-list">
          {agentFiles.map((f) => (
            <li key={f.path} onClick={() => void openFile(f.path, undefined, { retarget: true })}>
              <Icon name="agent" size={14} />
              <span className="mono">{displayPath(f.path)}</span>
              <span className="tag">{f.label ?? f.kind}</span>
              <span className="muted">~{fmtTokens(f.stats?.tokens ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="shortcuts">
        <div>
          <kbd>⌘P</kbd> Open file
        </div>
        <div>
          <kbd>⌘K</kbd> Commands
        </div>
        <div>
          <kbd>⌘⇧F</kbd> Search Markdown
        </div>
        <div>
          <kbd>⌘S</kbd> Save
        </div>
        <div>
          <kbd>⌘E</kbd> Cycle edit / split / preview
        </div>
        <div>
          <kbd>⌘⇧E</kbd> Effective context
        </div>
      </div>
    </div>
  );
}
