import { useEffect, useState } from 'react';
import { api } from './api';
import { cycleViewMode, showEffectiveContext } from './commands';
import { CommandPalette } from './components/CommandPalette';
import { ContextInspector } from './components/ContextInspector';
import { DocumentInspector } from './components/DocumentInspector';
import { EditorArea } from './components/EditorArea';
import { FileTree } from './components/FileTree';
import { Icon } from './components/Icon';
import { Modals, Toasts } from './components/Modals';
import { SearchPanel } from './components/SearchPanel';
import { StatusBar } from './components/StatusBar';
import { Welcome } from './components/Welcome';
import {
  CONTEXT_TAB,
  closeTab,
  focusSearch,
  handleRepoEvent,
  openRepository,
  openRepositoryDialog,
  refreshContext,
  refreshRecent,
  reloadRepository,
  saveActive,
  toggleTerminal,
  useStore,
} from './store';
import { applyTerminalTheme } from './lib/terminals';

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`' && useStore.getState().snapshot) {
        e.preventDefault();
        toggleTerminal();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === 's' && !e.shiftKey) run(() => void saveActive());
      else if (k === 'o' && !e.shiftKey) run(() => void openRepositoryDialog());
      else if (!s.snapshot) return;
      else if (k === 'p' && e.shiftKey) run(() => useStore.setState({ palette: 'commands' }));
      else if (k === 'p') run(() => useStore.setState({ palette: 'files' }));
      else if (k === 'k') run(() => useStore.setState({ palette: 'commands' }));
      else if (k === 'f' && e.shiftKey) run(focusSearch);
      else if (k === 'e' && e.shiftKey) run(showEffectiveContext);
      else if (k === 'e') run(cycleViewMode);
      else if (k === 'w' && s.activeTab) run(() => closeTab(s.activeTab!));
      else if (k === 'r' && e.shiftKey) run(() => void reloadRepository());
      else if (k === 'b')
        run(() => useStore.setState({ sidebarTab: s.sidebarTab === 'files' ? 'search' : 'files' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useTheme(): void {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
      applyTerminalTheme();
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Re-resolve the effective context whenever its inputs or the index change. */
function useContextRefresh(): void {
  const version = useStore((s) => s.snapshot?.version);
  const root = useStore((s) => s.snapshot?.root);
  const target = useStore((s) => s.target);
  const adapterId = useStore((s) => s.adapterId);
  const options = useStore((s) => s.adapterOptions);
  const experimental = useStore((s) => s.experimentalConflicts);
  useEffect(() => {
    if (!root) return;
    const t = setTimeout(() => void refreshContext(), 80);
    return () => clearTimeout(t);
  }, [root, version, target, adapterId, options, experimental]);
}

function Resizer({ side }: { side: 'left' | 'right' }) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const prop = side === 'left' ? '--sidebar-w' : '--inspector-w';
    const start = parseInt(getComputedStyle(document.documentElement).getPropertyValue(prop), 10);
    const move = (ev: MouseEvent) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      document.documentElement.style.setProperty(
        prop,
        `${Math.max(180, Math.min(600, start + delta))}px`,
      );
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return <div className={`resizer ${side}`} onMouseDown={onMouseDown} />;
}

function TopBar() {
  const snapshot = useStore((s) => s.snapshot);
  return (
    <header className="topbar">
      <button
        className="repo-button"
        onClick={() => void openRepositoryDialog()}
        title={snapshot?.root ?? 'Open repository'}
      >
        <Icon name="folder" size={14} />
        <span>{snapshot?.name ?? 'Open repository'}</span>
      </button>
      <span className="topbar-root muted">{snapshot?.root}</span>
      <button
        className="command-trigger"
        onClick={() => useStore.setState({ palette: 'commands' })}
      >
        <Icon name="search" size={13} />
        <span>Search commands and files</span>
        <kbd>⌘K</kbd>
      </button>
      <span className="spacer" />
      <button
        className="icon-btn"
        title="Reload repository (⌘⇧R)"
        onClick={() => void reloadRepository()}
      >
        <Icon name="refresh" size={14} />
      </button>
    </header>
  );
}

function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  return (
    <aside className="sidebar">
      <div className="panel-tabs">
        <button
          className={tab === 'files' ? 'on' : ''}
          onClick={() => useStore.setState({ sidebarTab: 'files' })}
        >
          <Icon name="files" size={13} /> Files
        </button>
        <button className={tab === 'search' ? 'on' : ''} onClick={focusSearch}>
          <Icon name="search" size={13} /> Search
        </button>
      </div>
      {tab === 'files' ? <FileTree /> : <SearchPanel />}
    </aside>
  );
}

function Inspector() {
  const tab = useStore((s) => s.inspectorTab);
  const active = useStore((s) => s.activeTab);
  const docPath = active && active !== CONTEXT_TAB ? active : null;
  return (
    <aside className="inspector">
      <div className="panel-tabs">
        <button
          className={tab === 'context' ? 'on' : ''}
          onClick={() => useStore.setState({ inspectorTab: 'context' })}
        >
          <Icon name="layers" size={13} /> Context
        </button>
        <button
          className={tab === 'document' ? 'on' : ''}
          onClick={() => useStore.setState({ inspectorTab: 'document' })}
        >
          <Icon name="file" size={13} /> Document
        </button>
      </div>
      {tab === 'context' ? (
        <ContextInspector />
      ) : docPath ? (
        <DocumentInspector path={docPath} />
      ) : (
        <div className="empty-inline muted">
          Open a Markdown file to see its outline, metadata, links and backlinks.
        </div>
      )}
    </aside>
  );
}

let bootStarted = false;

export function App() {
  const snapshot = useStore((s) => s.snapshot);
  const [booted, setBooted] = useState(false);
  useGlobalShortcuts();
  useTheme();
  useContextRefresh();

  useEffect(() => {
    const off = api().onEvent(handleRepoEvent);
    if (bootStarted) return off;
    bootStarted = true; // StrictMode runs effects twice in development; boot only once.
    void (async () => {
      const info = await api().getLaunchInfo();
      useStore.setState({ examplePath: info.examplePath });
      await refreshRecent();
      if (info.repository) await openRepository(info.repository);
      setBooted(true);
    })();
    return off;
  }, []);

  return (
    <div className="app">
      {!snapshot ? (
        booted ? (
          <Welcome />
        ) : (
          <div className="welcome" />
        )
      ) : (
        <>
          <TopBar />
          <div className="workbench">
            <Sidebar />
            <Resizer side="left" />
            <EditorArea />
            <Resizer side="right" />
            <Inspector />
          </div>
          <StatusBar />
        </>
      )}
      <CommandPalette />
      <Modals />
      <Toasts />
    </div>
  );
}
