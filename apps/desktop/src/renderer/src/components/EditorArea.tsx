import { baseName, dirOf, displayPath } from '../lib/format';
import {
  CONTEXT_TAB,
  closeTab,
  isDirty,
  keepMine,
  reloadFromDisk,
  saveFile,
  useStore,
  type ViewMode,
} from '../store';
import { ContextView } from './ContextView';
import { Editor } from './Editor';
import { Icon } from './Icon';
import { Preview } from './Preview';
import { RepoOverview } from './RepoOverview';

function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const buffers = useStore((s) => s.buffers);
  if (tabs.length === 0) return null;
  // Every directory may have its own AGENTS.md: disambiguate same-named tabs by directory.
  const nameCount = new Map<string, number>();
  for (const t of tabs) nameCount.set(baseName(t), (nameCount.get(baseName(t)) ?? 0) + 1);
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const b = buffers[t];
        const dirty = isDirty(b);
        const label = t === CONTEXT_TAB ? 'Effective context' : baseName(t);
        return (
          <div
            key={t}
            role="tab"
            aria-selected={t === active}
            className={`tab ${t === active ? 'active' : ''} ${b?.disk === 'deleted' ? 'deleted' : ''}`}
            onClick={() => useStore.setState({ activeTab: t })}
            onMouseDown={(e) => e.button === 1 && closeTab(t)}
            title={t === CONTEXT_TAB ? 'Effective context' : displayPath(t)}
          >
            {t === CONTEXT_TAB && <Icon name="layers" size={13} />}
            <span className="tab-label">{label}</span>
            {t !== CONTEXT_TAB && (nameCount.get(baseName(t)) ?? 0) > 1 && (
              <span className="tab-dir">{dirOf(t) || '/'}</span>
            )}
            <button
              className={`tab-close ${dirty ? 'dirty' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t);
              }}
              title={dirty ? 'Unsaved changes. Close…' : 'Close'}
            >
              {dirty ? <span className="dirty-dot" /> : <Icon name="close" size={11} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DiskBanner({ path }: { path: string }) {
  const b = useStore((s) => s.buffers[path]);
  if (!b) return null;
  if (b.disk === 'changed') {
    return (
      <div className="banner warning" role="alert">
        <Icon name="warning" size={14} />
        <span>
          This file changed on disk while you have unsaved edits. Neither version has been
          overwritten.
        </span>
        <button
          className="btn"
          onClick={() => useStore.setState({ modal: { type: 'compare', path } })}
        >
          Compare
        </button>
        <button className="btn" onClick={() => void reloadFromDisk(path)}>
          Load disk version
        </button>
        <button className="btn" onClick={() => keepMine(path)}>
          Keep mine
        </button>
      </div>
    );
  }
  if (b.disk === 'deleted') {
    return (
      <div className="banner warning" role="alert">
        <Icon name="warning" size={14} />
        <span>This file was deleted on disk. Your buffer is kept.</span>
        <button className="btn" onClick={() => void saveFile(path)}>
          Save to recreate
        </button>
        <button className="btn" onClick={() => closeTab(path, true)}>
          Close
        </button>
      </div>
    );
  }
  return null;
}

function ViewToggle() {
  const mode = useStore((s) => s.viewMode);
  const set = (viewMode: ViewMode) => useStore.setState({ viewMode });
  return (
    <div className="segmented" role="group" aria-label="View mode">
      {(['edit', 'split', 'preview'] as const).map((m) => (
        <button
          key={m}
          className={mode === m ? 'on' : ''}
          onClick={() => set(m)}
          title={`${m[0]!.toUpperCase()}${m.slice(1)} (⌘E cycles)`}
        >
          {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
        </button>
      ))}
    </div>
  );
}

export function EditorArea() {
  const active = useStore((s) => s.activeTab);
  const buffer = useStore((s) => (active ? s.buffers[active] : undefined));
  const mode = useStore((s) => s.viewMode);

  let body;
  if (!active) body = <RepoOverview />;
  else if (active === CONTEXT_TAB) body = <ContextView />;
  else if (!buffer || buffer.loading)
    body = (
      <div className="empty-state">
        <span className="spinner" />
      </div>
    );
  else if (buffer.error)
    body = (
      <div className="empty-state">
        <p className="error-text">{buffer.error}</p>
      </div>
    );
  else {
    body = (
      <>
        <div className="doc-toolbar">
          <span className="breadcrumb" title={displayPath(active)}>
            {active.split('/').map((part, i, arr) => (
              <span key={i} className={i === arr.length - 1 ? 'crumb last' : 'crumb'}>
                {part}
              </span>
            ))}
          </span>
          <span className="save-state">
            {isDirty(buffer) ? 'Modified' : buffer.disk === 'deleted' ? 'Deleted on disk' : 'Saved'}
          </span>
          <ViewToggle />
        </div>
        <DiskBanner path={active} />
        <div className={`doc-panes mode-${mode}`}>
          {mode !== 'preview' && <Editor path={active} />}
          {mode !== 'edit' && <Preview path={active} content={buffer.content} />}
        </div>
      </>
    );
  }
  return (
    <main className="editor-area">
      <Tabs />
      <div className="editor-body">{body}</div>
    </main>
  );
}
