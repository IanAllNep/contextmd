import {
  CONTEXT_TAB,
  closeRepository,
  closeTab,
  copyContext,
  focusSearch,
  openContextTab,
  openFile,
  openRepositoryDialog,
  reloadRepository,
  saveActive,
  useStore,
  type Theme,
  type ViewMode,
} from './store';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  when?: () => boolean;
  run: () => void;
}

const hasRepo = () => !!useStore.getState().snapshot;
const hasFile = () => {
  const t = useStore.getState().activeTab;
  return !!t && t !== CONTEXT_TAB;
};
const exists = (p: string) => !!useStore.getState().snapshot?.files.some((f) => f.path === p);

export function cycleViewMode(): void {
  const order: ViewMode[] = ['edit', 'split', 'preview'];
  const cur = useStore.getState().viewMode;
  useStore.setState({ viewMode: order[(order.indexOf(cur) + 1) % order.length]! });
}

export function showEffectiveContext(): void {
  useStore.setState({ inspectorTab: 'context' });
  openContextTab();
}

export function getCommands(): Command[] {
  const s = useStore.getState();
  const adapters = s.snapshot?.adapters ?? [];
  const cmds: Command[] = [
    {
      id: 'open-repo',
      title: 'Open Repository…',
      shortcut: '⌘O',
      run: () => void openRepositoryDialog(),
    },
    {
      id: 'open-file',
      title: 'Open File…',
      shortcut: '⌘P',
      when: hasRepo,
      run: () => useStore.setState({ palette: 'files' }),
    },
    { id: 'search', title: 'Search Markdown', shortcut: '⌘⇧F', when: hasRepo, run: focusSearch },
    {
      id: 'toggle-preview',
      title: 'Toggle Preview (cycle Edit / Split / Preview)',
      shortcut: '⌘E',
      run: cycleViewMode,
    },
    {
      id: 'show-context',
      title: 'Show Effective Context',
      shortcut: '⌘⇧E',
      when: hasRepo,
      run: showEffectiveContext,
    },
    {
      id: 'copy-context',
      title: 'Copy Effective Context (Markdown)',
      when: hasRepo,
      run: () => void copyContext('markdown'),
    },
    {
      id: 'copy-context-plain',
      title: 'Copy Effective Context (Plain text)',
      when: hasRepo,
      run: () => void copyContext('plain'),
    },
    {
      id: 'copy-context-json',
      title: 'Copy Effective Context (JSON with provenance)',
      when: hasRepo,
      run: () => void copyContext('json'),
    },
    {
      id: 'set-target',
      title: 'Set Context Launch Directory…',
      when: hasRepo,
      run: () => useStore.setState({ palette: 'dirs' }),
    },
    { id: 'reload', title: 'Reload Repository', when: hasRepo, run: () => void reloadRepository() },
    {
      id: 'open-agents',
      title: 'Open AGENTS.md',
      when: () => exists('AGENTS.md'),
      run: () => void openFile('AGENTS.md', undefined, { retarget: true }),
    },
    {
      id: 'open-claude',
      title: 'Open CLAUDE.md',
      when: () => exists('CLAUDE.md'),
      run: () => void openFile('CLAUDE.md', undefined, { retarget: true }),
    },
    {
      id: 'show-backlinks',
      title: 'Show Backlinks / Outline / Metadata',
      when: hasFile,
      run: () => useStore.setState({ inspectorTab: 'document' }),
    },
    { id: 'save', title: 'Save', shortcut: '⌘S', when: hasFile, run: () => void saveActive() },
    {
      id: 'close-tab',
      title: 'Close Tab',
      shortcut: '⌘W',
      when: () => !!useStore.getState().activeTab,
      run: () => closeTab(useStore.getState().activeTab!),
    },
    {
      id: 'agent-only',
      title: 'Toggle Agent Files Only (file tree)',
      when: hasRepo,
      run: () => useStore.setState((st) => ({ agentOnly: !st.agentOnly })),
    },
    {
      id: 'conflicts',
      title: 'Toggle Experimental Conflict Detection',
      when: hasRepo,
      run: () => useStore.setState((st) => ({ experimentalConflicts: !st.experimentalConflicts })),
    },
    ...adapters.map((a) => ({
      id: `adapter-${a.id}`,
      title: `Harness: ${a.name}${a.fidelity === 'heuristic' ? ' (heuristic)' : ''}`,
      run: () => useStore.setState({ adapterId: a.id, inspectorTab: 'context' }),
    })),
    ...(['system', 'light', 'dark'] as Theme[]).map((t) => ({
      id: `theme-${t}`,
      title: `Theme: ${t[0]!.toUpperCase()}${t.slice(1)}`,
      run: () => useStore.setState({ theme: t }),
    })),
    {
      id: 'close-repo',
      title: 'Close Repository',
      when: hasRepo,
      run: () => void closeRepository(),
    },
  ];
  return cmds.filter((c) => !c.when || c.when());
}
