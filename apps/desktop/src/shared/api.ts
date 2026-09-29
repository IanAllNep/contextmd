/**
 * The only contract between the renderer (UI) and the main process (filesystem + index).
 * Paths are always repository-relative; the main process validates them.
 */
import type {
  AdapterOptions,
  AdapterOptionSpec,
  Backlink,
  BrokenLink,
  ChangeSummary,
  ContextTarget,
  Diagnostic,
  DocumentSummary,
  ExportFormat,
  IndexProgress,
  MarkdownDocument,
  RenderedContext,
  ResolvedContext,
  SearchOptions,
  SearchResult,
} from '@contextmd/core';

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  fidelity: 'heuristic' | 'documented';
  references: { title: string; url: string }[];
  verifiedOn?: string;
  options: AdapterOptionSpec[];
  detected: boolean;
  evidence: string[];
}

export interface RepoSnapshot {
  root: string;
  name: string;
  version: number;
  files: DocumentSummary[];
  directories: string[];
  adapters: AdapterInfo[];
  scanTruncated: boolean;
  ignoredCount: number;
  indexedAt: number;
}

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

export interface OpenedFile {
  path: string;
  content: string;
  /** sha256 of the content; the base for conflict detection on save. */
  hash: string;
  mtimeMs: number;
}

export interface DocumentDetail {
  summary: DocumentSummary;
  doc: MarkdownDocument | null;
  backlinks: Backlink[];
  brokenLinks: BrokenLink[];
}

export type SaveResult =
  | { ok: true; hash: string; mtimeMs: number }
  | { ok: false; reason: 'conflict'; diskHash: string | null; diskContent: string | null }
  | { ok: false; reason: 'error'; message: string };

export interface ContextRequest {
  adapterId: string;
  target: ContextTarget;
  options?: AdapterOptions;
  experimentalConflicts?: boolean;
}

export interface ContextResponse {
  resolved: ResolvedContext;
  rendered: RenderedContext;
  diagnostics: Diagnostic[];
}

export type RepoEvent =
  | { type: 'indexing'; progress: IndexProgress }
  | { type: 'index-changed'; snapshot: RepoSnapshot; summary: ChangeSummary }
  | { type: 'files-changed'; changed: string[]; removed: string[] }
  | { type: 'watch-error'; message: string };

export interface ContextMdApi {
  openRepositoryDialog(): Promise<RepoSnapshot | null>;
  openRepository(path: string): Promise<RepoSnapshot>;
  /** Repository passed on the command line, or the bundled example in development. */
  getLaunchInfo(): Promise<{ repository: string | null; examplePath: string | null }>;
  getRecent(): Promise<RecentRepo[]>;
  removeRecent(path: string): Promise<RecentRepo[]>;
  closeRepository(): Promise<void>;
  reload(): Promise<RepoSnapshot>;
  readFile(path: string): Promise<OpenedFile>;
  saveFile(
    path: string,
    content: string,
    baseHash: string | null,
    force: boolean,
  ): Promise<SaveResult>;
  getDocument(path: string): Promise<DocumentDetail | null>;
  search(query: string, options: SearchOptions): Promise<SearchResult>;
  resolveContext(request: ContextRequest): Promise<ContextResponse>;
  exportContext(request: ContextRequest, format: ExportFormat): Promise<string>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  setDirty(dirty: boolean): void;
  onEvent(listener: (event: RepoEvent) => void): () => void;
}

export const IPC = {
  invoke: 'contextmd:invoke',
  event: 'contextmd:event',
  dirty: 'contextmd:dirty',
} as const;

export type InvokeMethod = Exclude<keyof ContextMdApi, 'onEvent' | 'setDirty'>;
