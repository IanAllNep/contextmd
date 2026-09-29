import { openRepository, openRepositoryDialog, removeRecent, useStore } from '../store';
import { Icon } from './Icon';

export function Welcome() {
  const recent = useStore((s) => s.recent);
  const examplePath = useStore((s) => s.examplePath);
  const opening = useStore((s) => s.opening);
  const indexing = useStore((s) => s.indexing);
  const error = useStore((s) => s.openError);
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>ContextMD</h1>
        <p className="lead">
          See which Markdown instructions reach your coding agent, and where each one comes from.
        </p>
        <div className="welcome-actions">
          <button
            className="btn primary large"
            onClick={() => void openRepositoryDialog()}
            disabled={opening}
          >
            <Icon name="folder" size={15} /> Open repository… <kbd>⌘O</kbd>
          </button>
          {examplePath && (
            <button
              className="btn large"
              onClick={() => void openRepository(examplePath)}
              disabled={opening}
            >
              Open example project
            </button>
          )}
        </div>
        {opening && (
          <p className="muted">
            {indexing?.phase === 'parsing'
              ? `Parsing ${indexing.done} / ${indexing.total} Markdown files…`
              : 'Scanning files…'}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {recent.length > 0 && (
          <section className="recent">
            <h3>Recent</h3>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button
                    className="recent-item"
                    onClick={() => void openRepository(r.path)}
                    title={r.path}
                  >
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.path}</span>
                  </button>
                  <button
                    className="icon-btn"
                    title="Remove from list"
                    onClick={() => void removeRecent(r.path)}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="fineprint">
          Everything runs locally. Nothing in the opened repository is executed, and no account or
          API key is needed.
        </p>
      </div>
    </div>
  );
}
