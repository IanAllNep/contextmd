import { create } from 'zustand';
import type { AdapterOptions, ContextTarget, IndexProgress, SearchResult } from '@contextmd/core';
import type {
  ContextResponse,
  RecentRepo,
  RepoEvent,
  RepoSnapshot,
  TerminalInfo,
} from '../../shared/api';
import { api } from './api';
import { dirOf, displayPath } from './lib/format';
import {
  disposeAllTerminals,
  disposeTerminal,
  onTerminalInput,
  writeTerminal,
} from './lib/terminals';

export const CONTEXT_TAB = 'context://effective';

export type ViewMode = 'edit' | 'split' | 'preview';
export type Theme = 'system' | 'light' | 'dark';

/**
 * Editor buffer for one open file.
 * - content/savedContent: dirty = content !== savedContent
 * - baseHash: hash of the disk content this buffer is based on (null = file doesn't exist)
 * - disk: relationship between buffer and disk
 */
export interface Buffer {
  path: string;
  content: string;
  savedContent: string;
  baseHash: string | null;
  mtimeMs: number;
  disk: 'synced' | 'changed' | 'deleted';
  diskContent: string | null;
  loading: boolean;
  error: string | null;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface TerminalTab extends TerminalInfo {
  exitCode: number | null;
  /** The user has typed into this terminal (hides the "press Enter" hint). */
  typed: boolean;
}

export type Modal =
  | { type: 'confirm-close'; path: string }
  | { type: 'save-conflict'; path: string; diskContent: string | null }
  | { type: 'compare'; path: string }
  | null;

interface Prefs {
  viewMode: ViewMode;
  theme: Theme;
  adapterId: string;
  experimentalConflicts: boolean;
  agentOnly: boolean;
}

const PREFS_KEY = 'contextmd.prefs.v1';
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

export interface State extends Prefs {
  snapshot: RepoSnapshot | null;
  opening: boolean;
  indexing: IndexProgress | null;
  recent: RecentRepo[];
  examplePath: string | null;
  openError: string | null;

  tabs: string[];
  activeTab: string | null;
  buffers: Record<string, Buffer>;
  navRequest: { path: string; line: number; nonce: number } | null;
  cursor: { line: number; col: number } | null;

  sidebarTab: 'files' | 'search';
  inspectorTab: 'document' | 'context';
  expanded: Record<string, boolean>;
  selectedDir: string | null;
  treeFilter: string;

  target: ContextTarget;
  pinCwd: boolean;
  adapterOptions: Record<string, AdapterOptions>;
  context: ContextResponse | null;
  contextLoading: boolean;
  contextError: string | null;

  searchQuery: string;
  searchCase: boolean;
  searchRegex: boolean;
  searchAgentOnly: boolean;
  searchResult: SearchResult | null;
  searchFocusNonce: number;

  terminals: TerminalTab[];
  activeTerminal: number | null;
  terminalOpen: boolean;

  palette: null | 'commands' | 'files' | 'dirs';
  modal: Modal;
  toasts: Toast[];
}

const prefs = loadPrefs();

export const useStore = create<State>(() => ({
  snapshot: null,
  opening: false,
  indexing: null,
  recent: [],
  examplePath: null,
  openError: null,
  tabs: [],
  activeTab: null,
  buffers: {},
  navRequest: null,
  cursor: null,
  sidebarTab: 'files',
  inspectorTab: 'context',
  expanded: { '': true },
  selectedDir: null,
  treeFilter: '',
  target: { cwd: '', file: null },
  pinCwd: false,
  adapterOptions: {},
  context: null,
  contextLoading: false,
  contextError: null,
  searchQuery: '',
  searchCase: false,
  searchRegex: false,
  searchAgentOnly: false,
  searchResult: null,
  searchFocusNonce: 0,
  terminals: [],
  activeTerminal: null,
  terminalOpen: false,
  palette: null,
  modal: null,
  toasts: [],
  viewMode: prefs.viewMode ?? 'split',
  theme: prefs.theme ?? 'system',
  adapterId: prefs.adapterId ?? 'generic',
  experimentalConflicts: prefs.experimentalConflicts ?? true,
  agentOnly: prefs.agentOnly ?? false,
}));

const set = useStore.setState;
const get = useStore.getState;

useStore.subscribe((s, prev) => {
  if (
    s.viewMode !== prev.viewMode ||
    s.theme !== prev.theme ||
    s.adapterId !== prev.adapterId ||
    s.experimentalConflicts !== prev.experimentalConflicts ||
    s.agentOnly !== prev.agentOnly
  ) {
    savePrefs({
      viewMode: s.viewMode,
      theme: s.theme,
      adapterId: s.adapterId,
      experimentalConflicts: s.experimentalConflicts,
      agentOnly: s.agentOnly,
    });
  }
  // Tell the main process whether closing the window would lose data.
  if (s.buffers !== prev.buffers) api().setDirty(hasDirty(s));
});

export const isDirty = (b: Buffer | undefined): boolean => !!b && b.content !== b.savedContent;
export const hasDirty = (s: State): boolean => Object.values(s.buffers).some(isDirty);

let toastId = 0;
export function toast(kind: Toast['kind'], message: string, ms = 3500): void {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, kind, message }].slice(-3) }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
};

function patchBuffer(path: string, patch: Partial<Buffer>): void {
  set((s) => {
    const b = s.buffers[path];
    if (!b) return {};
    return { buffers: { ...s.buffers, [path]: { ...b, ...patch } } };
  });
}

// ---------------------------------------------------------------- repository

function applySnapshot(snapshot: RepoSnapshot): void {
  const s = get();
  const adapterId = snapshot.adapters.some((a) => a.id === s.adapterId) ? s.adapterId : 'generic';
  set({ snapshot, adapterId, indexing: null, opening: false, openError: null });
}

async function afterOpen(snapshot: RepoSnapshot): Promise<void> {
  resetTerminals();
  set({
    tabs: [],
    activeTab: null,
    buffers: {},
    expanded: { '': true },
    selectedDir: null,
    target: { cwd: '', file: null },
    pinCwd: false,
    context: null,
    searchResult: null,
    treeFilter: '',
  });
  applySnapshot(snapshot);
  // Expand directories that hold instruction files so nested instructions are visible.
  const expanded: Record<string, boolean> = { '': true };
  for (const f of snapshot.files) {
    if (f.kind !== 'instructions') continue;
    let d = f.dir;
    while (d !== '') {
      expanded[d] = true;
      d = dirOf(d);
    }
  }
  set({ expanded });
  const first = ['AGENTS.md', 'CLAUDE.md', 'README.md'].find((p) =>
    snapshot.files.some((f) => f.path === p),
  );
  if (first) await openFile(first, undefined, { retarget: true });
  void refreshRecent();
}

async function guardDirty(action: string): Promise<boolean> {
  if (!hasDirty(get())) return true;
  toast('warning', `Save or close modified files before ${action}.`, 5000);
  return false;
}

export async function openRepositoryDialog(): Promise<void> {
  if (!(await guardDirty('opening another repository'))) return;
  try {
    const snap = await api().openRepositoryDialog();
    if (snap) await afterOpen(snap);
  } catch (e) {
    set({ opening: false, openError: errMsg(e) });
  }
}

export async function openRepository(path: string): Promise<void> {
  if (!(await guardDirty('opening another repository'))) return;
  set({ opening: true, openError: null });
  try {
    await afterOpen(await api().openRepository(path));
  } catch (e) {
    set({ opening: false, openError: errMsg(e), indexing: null });
  }
}

export async function closeRepository(): Promise<void> {
  if (!(await guardDirty('closing the repository'))) return;
  await api().closeRepository();
  resetTerminals();
  set({
    snapshot: null,
    tabs: [],
    activeTab: null,
    buffers: {},
    context: null,
    searchResult: null,
  });
  void refreshRecent();
}

export async function reloadRepository(): Promise<void> {
  try {
    applySnapshot(await api().reload());
    toast('info', 'Repository re-indexed');
  } catch (e) {
    toast('error', errMsg(e));
  }
}

export async function refreshRecent(): Promise<void> {
  set({ recent: await api().getRecent() });
}

export async function removeRecent(path: string): Promise<void> {
  set({ recent: await api().removeRecent(path) });
}

// ---------------------------------------------------------------- tabs / files

/**
 * Opens a file in a tab. `retarget` makes the context target follow the file; it is used for
 * deliberate file selection (tree, quick open) but not when following a link or a context
 * source, so inspecting provenance never changes the context being inspected.
 */
export async function openFile(
  path: string,
  line?: number,
  opts: { retarget?: boolean } = {},
): Promise<void> {
  const s = get();
  if (!s.tabs.includes(path)) set({ tabs: [...s.tabs, path] });
  set({ activeTab: path });
  if (opts.retarget) {
    set((st) => ({
      selectedDir: null,
      target: { cwd: st.pinCwd ? st.target.cwd : dirOf(path), file: path },
    }));
  }
  if (line !== undefined) set({ navRequest: { path, line, nonce: Date.now() } });
  if (s.buffers[path]) return;
  set((st) => ({
    buffers: {
      ...st.buffers,
      [path]: {
        path,
        content: '',
        savedContent: '',
        baseHash: null,
        mtimeMs: 0,
        disk: 'synced',
        diskContent: null,
        loading: true,
        error: null,
      },
    },
  }));
  try {
    const f = await api().readFile(path);
    patchBuffer(path, {
      content: f.content,
      savedContent: f.content,
      baseHash: f.hash,
      mtimeMs: f.mtimeMs,
      loading: false,
    });
    if (line !== undefined) set({ navRequest: { path, line, nonce: Date.now() } });
  } catch (e) {
    patchBuffer(path, { loading: false, error: errMsg(e) });
  }
}

export function openContextTab(): void {
  const s = get();
  set({
    tabs: s.tabs.includes(CONTEXT_TAB) ? s.tabs : [...s.tabs, CONTEXT_TAB],
    activeTab: CONTEXT_TAB,
  });
}

export function closeTab(path: string, force = false): void {
  const s = get();
  if (!force && isDirty(s.buffers[path])) {
    set({ modal: { type: 'confirm-close', path } });
    return;
  }
  const idx = s.tabs.indexOf(path);
  const tabs = s.tabs.filter((t) => t !== path);
  const buffers = { ...s.buffers };
  delete buffers[path];
  const activeTab =
    s.activeTab === path ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : s.activeTab;
  set({ tabs, buffers, activeTab, modal: null });
}

export function updateContent(path: string, content: string): void {
  const b = get().buffers[path];
  if (b && b.content !== content) patchBuffer(path, { content });
}

export async function saveFile(path: string, force = false): Promise<void> {
  const b = get().buffers[path];
  if (!b || b.loading) return;
  const content = b.content;
  const res = await api().saveFile(path, content, b.baseHash, force);
  if (res.ok) {
    patchBuffer(path, {
      savedContent: content,
      baseHash: res.hash,
      mtimeMs: res.mtimeMs,
      disk: 'synced',
      diskContent: null,
    });
    set({ modal: null });
    toast('success', `Saved ${displayPath(path)}`, 1800);
  } else if (res.reason === 'conflict') {
    // Never overwrite silently: the user decides.
    patchBuffer(path, {
      disk: res.diskContent === null ? 'deleted' : 'changed',
      diskContent: res.diskContent,
    });
    set({ modal: { type: 'save-conflict', path, diskContent: res.diskContent } });
  } else {
    toast('error', `Could not save: ${res.message}`, 6000);
  }
}

export async function saveActive(): Promise<void> {
  const { activeTab } = get();
  if (activeTab && activeTab !== CONTEXT_TAB) await saveFile(activeTab);
}

/** Discards local edits and loads the disk version. */
export async function reloadFromDisk(path: string): Promise<void> {
  try {
    const f = await api().readFile(path);
    patchBuffer(path, {
      content: f.content,
      savedContent: f.content,
      baseHash: f.hash,
      mtimeMs: f.mtimeMs,
      disk: 'synced',
      diskContent: null,
    });
    set({ modal: null });
  } catch (e) {
    toast('error', errMsg(e));
  }
}

/** Keep local edits. Since baseHash is unchanged, the conflict resurfaces on save. */
export function keepMine(path: string): void {
  if (get().buffers[path]?.disk === 'changed') patchBuffer(path, { disk: 'synced' });
  set({ modal: null });
}

/** Reconciles open buffers with files that changed on disk. */
async function onFilesChanged(changed: string[], removed: string[]): Promise<void> {
  const { buffers } = get();
  for (const path of removed) {
    const b = buffers[path];
    if (!b) continue;
    patchBuffer(path, { disk: 'deleted', baseHash: null, diskContent: null });
    // Keep the buffer so no work is lost; a clean buffer is marked dirty-equivalent via disk state.
    toast('warning', `${displayPath(path)} was deleted on disk`, 5000);
  }
  for (const path of changed) {
    const b = get().buffers[path];
    if (!b || b.loading) continue;
    let f;
    try {
      f = await api().readFile(path);
    } catch {
      continue;
    }
    const current = get().buffers[path];
    if (!current || f.hash === current.baseHash) continue; // our own save, or no real change
    if (!isDirty(current)) {
      patchBuffer(path, {
        content: f.content,
        savedContent: f.content,
        baseHash: f.hash,
        mtimeMs: f.mtimeMs,
        disk: 'synced',
        diskContent: null,
      });
      toast('info', `Reloaded ${displayPath(path)} (changed on disk)`);
    } else {
      patchBuffer(path, { disk: 'changed', diskContent: f.content });
    }
  }
}

export function handleRepoEvent(e: RepoEvent): void {
  if (e.type === 'indexing') set({ indexing: e.progress.phase === 'done' ? null : e.progress });
  else if (e.type === 'index-changed') applySnapshot(e.snapshot);
  else if (e.type === 'files-changed') void onFilesChanged(e.changed, e.removed);
  else if (e.type === 'watch-error') toast('error', `File watcher: ${e.message}`, 6000);
  else if (e.type === 'terminal-data') writeTerminal(e.id, e.data);
  else if (e.type === 'terminal-exit') {
    writeTerminal(e.id, `\r\n\x1b[2m[process exited with code ${e.exitCode}]\x1b[0m\r\n`);
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === e.id ? { ...t, exitCode: e.exitCode } : t)),
    }));
  }
}

// ---------------------------------------------------------------- terminal

onTerminalInput((id) => {
  const t = get().terminals.find((x) => x.id === id);
  if (t && !t.typed)
    set((s) => ({ terminals: s.terminals.map((x) => (x.id === id ? { ...x, typed: true } : x)) }));
});

function resetTerminals(): void {
  disposeAllTerminals();
  set({ terminals: [], activeTerminal: null, terminalOpen: false });
}

/**
 * Opens a shell in a repository directory (default: the context launch directory).
 * With `adapterId`, that harness's command is typed at the prompt but not run.
 */
export async function newTerminal(opts: { cwd?: string; adapterId?: string } = {}): Promise<void> {
  const s = get();
  if (!s.snapshot) return;
  try {
    const req: { cwd: string; cols: number; rows: number; adapterId?: string } = {
      cwd: opts.cwd ?? s.target.cwd,
      cols: 100,
      rows: 24,
    };
    if (opts.adapterId) req.adapterId = opts.adapterId;
    const info = await api().terminalCreate(req);
    set((st) => ({
      terminals: [...st.terminals, { ...info, exitCode: null, typed: false }],
      activeTerminal: info.id,
      terminalOpen: true,
    }));
  } catch (e) {
    toast('error', `Could not start a terminal: ${errMsg(e)}`, 6000);
  }
}

export function killTerminal(id: number): void {
  void api().terminalKill(id);
  disposeTerminal(id);
  set((s) => {
    const terminals = s.terminals.filter((t) => t.id !== id);
    return {
      terminals,
      activeTerminal: s.activeTerminal === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminal,
      terminalOpen: terminals.length > 0 && s.terminalOpen,
    };
  });
}

export function toggleTerminal(): void {
  const s = get();
  if (!s.terminalOpen && s.terminals.length === 0) void newTerminal();
  else set({ terminalOpen: !s.terminalOpen });
}

// ---------------------------------------------------------------- navigation

export function navigate(path: string, line: number): void {
  if (get().activeTab === path) set({ navRequest: { path, line, nonce: Date.now() } });
  else void openFile(path, line);
}

export function selectDirectory(dir: string): void {
  set({ selectedDir: dir, target: { cwd: dir, file: null }, inspectorTab: 'context' });
}

export function setTarget(target: Partial<ContextTarget>): void {
  set((s) => ({ target: { ...s.target, ...target } }));
}

// ---------------------------------------------------------------- context

let contextSeq = 0;
export async function refreshContext(): Promise<void> {
  const s = get();
  if (!s.snapshot) return;
  const seq = ++contextSeq;
  set({ contextLoading: true });
  try {
    const context = await api().resolveContext({
      adapterId: s.adapterId,
      target: s.target,
      options: s.adapterOptions[s.adapterId] ?? {},
      experimentalConflicts: s.experimentalConflicts,
    });
    if (seq === contextSeq) set({ context, contextLoading: false, contextError: null });
  } catch (e) {
    if (seq === contextSeq) set({ contextLoading: false, contextError: errMsg(e) });
  }
}

export async function copyContext(
  format: 'markdown' | 'plain' | 'json' = 'markdown',
): Promise<void> {
  const s = get();
  if (!s.snapshot) return;
  try {
    const text = await api().exportContext(
      { adapterId: s.adapterId, target: s.target, options: s.adapterOptions[s.adapterId] ?? {} },
      format,
    );
    await api().copyText(text);
    toast('success', `Copied effective context (${format}) to the clipboard`);
  } catch (e) {
    toast('error', errMsg(e));
  }
}

// ---------------------------------------------------------------- search

let searchSeq = 0;
export async function runSearch(): Promise<void> {
  const s = get();
  if (!s.snapshot) return;
  const seq = ++searchSeq;
  if (s.searchQuery.trim() === '') {
    set({ searchResult: null });
    return;
  }
  const result = await api().search(s.searchQuery, {
    caseSensitive: s.searchCase,
    regex: s.searchRegex,
    agentOnly: s.searchAgentOnly,
    limit: 1000,
  });
  if (seq === searchSeq) set({ searchResult: result });
}

export function focusSearch(): void {
  set((s) => ({ sidebarTab: 'search', searchFocusNonce: s.searchFocusNonce + 1 }));
}
