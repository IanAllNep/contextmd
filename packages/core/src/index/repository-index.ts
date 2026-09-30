import type { FileSystem } from '../fs/types';
import { parseMarkdown } from '../markdown/parse';
import { basenameRel, dirnameRel, isWithin, joinRel, toAbs, toRel } from '../paths';
import { classify, type RecognizedPattern, RECOGNIZED_PATTERNS } from '../scan/classify';
import { IgnoreRules, isMarkdownPath } from '../scan/ignore';
import {
  DEFAULT_ROOT_MARKERS,
  scanRepository,
  statSymlinkedFile,
  type ScanOptions,
  type ScannedFile,
} from '../scan/scanner';
import { defaultEstimator, type TokenEstimator } from '../tokens/estimate';
import { searchDocuments } from './search';
import type {
  Backlink,
  BrokenLink,
  ChangeSummary,
  DocumentSummary,
  FileChange,
  IndexedDocument,
  IndexProgress,
  SearchOptions,
  SearchResult,
} from './types';

export interface IndexOptions extends ScanOptions {
  /** Files larger than this are listed but not read or parsed. Default 2 MiB. */
  maxParseBytes?: number;
  estimator?: TokenEstimator;
  patterns?: readonly RecognizedPattern[];
  onProgress?: (p: IndexProgress) => void;
}

const PARSE_CONCURRENCY = 16;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * In-memory index of a repository's Markdown. Pure data + queries; knows nothing about
 * any UI. Build with `RepositoryIndex.open`, keep fresh with `applyChanges`.
 */
export class RepositoryIndex {
  private docs = new Map<string, IndexedDocument>();
  private dirs = new Set<string>();
  private markerDirs: Record<string, string[]> = {};
  private backlinkMap = new Map<string, Backlink[]>();
  private rules: IgnoreRules;
  private realRoot: string;
  scanTruncated = false;
  ignoredCount = 0;

  private constructor(
    readonly root: string,
    readonly fs: FileSystem,
    private readonly options: IndexOptions,
  ) {
    this.rules = this.newRules();
    this.realRoot = root;
  }

  static async open(
    root: string,
    fs: FileSystem,
    options: IndexOptions = {},
  ): Promise<RepositoryIndex> {
    const index = new RepositoryIndex(root.replace(/\\/g, '/').replace(/\/+$/, ''), fs, options);
    await index.rescan();
    return index;
  }

  get estimator(): TokenEstimator {
    return this.options.estimator ?? defaultEstimator;
  }

  private newRules(): IgnoreRules {
    return new IgnoreRules(this.options.extraIgnoredDirs, this.options.useGitignore ?? true);
  }

  /** Full rescan. Also used when ignore rules change. */
  async rescan(): Promise<void> {
    const progress = this.options.onProgress;
    progress?.({ phase: 'scanning', done: 0, total: 0 });
    this.realRoot = await this.fs.realpath(this.root);
    this.rules = this.newRules();
    const scan = await scanRepository(this.fs, this.root, this.options, this.rules);
    this.scanTruncated = scan.truncated;
    this.ignoredCount = scan.ignoredCount;
    this.markerDirs = scan.markerDirs;
    this.dirs = new Set(scan.directories);
    let done = 0;
    const total = scan.markdown.length;
    progress?.({ phase: 'parsing', done, total });
    const docs = await mapPool(scan.markdown, PARSE_CONCURRENCY, async (f) => {
      const d = await this.load(f);
      done++;
      if (done % 25 === 0) progress?.({ phase: 'parsing', done, total });
      return d;
    });
    this.docs = new Map(docs.map((d) => [d.path, d]));
    this.rebuildLinkGraph();
    progress?.({ phase: 'done', done: total, total });
  }

  private async load(file: ScannedFile): Promise<IndexedDocument> {
    const classification = classify(file.path, this.options.patterns ?? RECOGNIZED_PATTERNS);
    const base: IndexedDocument = { ...file, classification, doc: null, content: null };
    const maxBytes = this.options.maxParseBytes ?? 2 * 1024 * 1024;
    if (file.size > maxBytes)
      return { ...base, error: `File is larger than ${maxBytes} bytes; not parsed.` };
    try {
      const content = await this.fs.readFile(toAbs(this.root, file.path));
      const doc = parseMarkdown(file.path, content, { estimator: this.estimator });
      return { ...base, content, doc };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Replaces the recognized filename patterns and reclassifies every document. */
  setPatterns(patterns: readonly RecognizedPattern[]): void {
    this.options.patterns = patterns;
    for (const [path, d] of this.docs)
      this.docs.set(path, { ...d, classification: classify(path, patterns) });
  }

  // ---------------------------------------------------------------- queries

  get size(): number {
    return this.docs.size;
  }

  get(path: string): IndexedDocument | undefined {
    return this.docs.get(path);
  }

  has(path: string): boolean {
    return this.docs.has(path);
  }

  documents(): IndexedDocument[] {
    return [...this.docs.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  directories(): string[] {
    return [...this.dirs].sort();
  }

  hasDirectory(dir: string): boolean {
    return this.dirs.has(dir);
  }

  /** Directories that contain a project-root marker such as `.git`. */
  markers(): Record<string, string[]> {
    return this.markerDirs;
  }

  summary(path: string): DocumentSummary | undefined {
    const d = this.docs.get(path);
    return d ? this.toSummary(d) : undefined;
  }

  summaries(): DocumentSummary[] {
    return this.documents().map((d) => this.toSummary(d));
  }

  private toSummary(d: IndexedDocument): DocumentSummary {
    const s: DocumentSummary = {
      path: d.path,
      name: basenameRel(d.path),
      dir: dirnameRel(d.path),
      size: d.size,
      mtimeMs: d.mtimeMs,
      kind: d.classification.kind,
      patternId: d.classification.patternId,
      label: d.classification.label,
      title: d.doc?.title ?? null,
      stats: d.doc?.stats ?? null,
      headingCount: d.doc?.headings.length ?? 0,
      linkCount: d.doc?.links.length ?? 0,
      backlinkCount: this.backlinkMap.get(d.path)?.length ?? 0,
    };
    if (d.symlinkTarget !== undefined) s.symlinkTarget = d.symlinkTarget;
    if (d.error !== undefined) s.error = d.error;
    return s;
  }

  backlinks(path: string): Backlink[] {
    return this.backlinkMap.get(path) ?? [];
  }

  /**
   * Resolves a link target to an indexed document, trying the path as-is, with `.md`, and
   * as a directory README. Returns null if nothing in the index matches.
   */
  resolveDocumentPath(target: string): string | null {
    if (this.docs.has(target)) return target;
    if (this.docs.has(target + '.md')) return target + '.md';
    for (const readme of ['README.md', 'readme.md', 'index.md']) {
      const p = joinRel(target, readme);
      if (this.docs.has(p)) return p;
    }
    return null;
  }

  /** Internal links to Markdown paths that don't exist in the index or on disk. */
  async brokenLinks(path?: string): Promise<BrokenLink[]> {
    const out: BrokenLink[] = [];
    const docs = path ? [this.docs.get(path)].filter((d) => d !== undefined) : this.docs.values();
    for (const d of docs) {
      for (const l of d.doc?.links ?? []) {
        if (l.kind !== 'internal') continue;
        if (l.target === null || l.target === undefined) {
          out.push({ from: d.path, href: l.href, line: l.line, target: null });
          continue;
        }
        if (!isMarkdownPath(l.target) || this.resolveDocumentPath(l.target)) continue;
        if (await this.exists(l.target)) continue; // exists but ignored / not indexed
        out.push({ from: d.path, href: l.href, line: l.line, target: l.target });
      }
    }
    return out;
  }

  search(query: string, options?: SearchOptions): SearchResult {
    return searchDocuments(this.documents(), query, options);
  }

  isIgnored(rel: string, isDirectory: boolean): boolean {
    return this.rules.isIgnored(rel, isDirectory);
  }

  // ---------------------------------------------------------- file access

  /**
   * Reads any file inside the repository (not only indexed Markdown), refusing paths that
   * resolve outside the root through symlinks. Returns null if missing or outside.
   */
  async readRepoFile(rel: string): Promise<string | null> {
    try {
      const real = await this.fs.realpath(toAbs(this.root, rel));
      if (toRel(this.realRoot, real) === null) return null;
      return await this.fs.readFile(real);
    } catch {
      return null;
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await this.fs.stat(toAbs(this.root, rel));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------- incremental updates

  /**
   * Applies filesystem change events. Only affected files are re-read and re-parsed.
   * A change to any `.gitignore` triggers a full rescan since it can change what's visible.
   */
  async applyChanges(changes: FileChange[]): Promise<ChangeSummary> {
    const summary: ChangeSummary = {
      added: [],
      changed: [],
      removed: [],
      directoriesChanged: false,
      rescanned: false,
    };
    if (changes.some((c) => basenameRel(c.path) === '.gitignore')) {
      const before = new Map([...this.docs].map(([p, d]) => [p, d.mtimeMs]));
      await this.rescan();
      for (const [p, d] of this.docs) {
        if (!before.has(p)) summary.added.push(p);
        else if (before.get(p) !== d.mtimeMs) summary.changed.push(p);
      }
      for (const p of before.keys()) if (!this.docs.has(p)) summary.removed.push(p);
      summary.rescanned = true;
      summary.directoriesChanged = true;
      return summary;
    }

    // Collapse to the last event per path.
    const latest = new Map<string, FileChange>();
    for (const c of changes) latest.set(c.path, c);

    for (const c of latest.values()) {
      if (c.type === 'addDir') {
        if (!this.rules.isIgnored(c.path, true) && !this.dirs.has(c.path)) {
          this.addDirWithAncestors(c.path);
          summary.directoriesChanged = true;
        }
      } else if (c.type === 'unlinkDir') {
        for (const d of [...this.dirs]) {
          if (d !== '' && isWithin(d, c.path)) {
            this.dirs.delete(d);
            summary.directoriesChanged = true;
          }
        }
        for (const p of [...this.docs.keys()]) {
          if (isWithin(p, c.path)) {
            this.docs.delete(p);
            summary.removed.push(p);
          }
        }
      } else if (c.type === 'unlink') {
        if (this.docs.delete(c.path)) summary.removed.push(c.path);
      } else {
        if (!isMarkdownPath(c.path) || this.rules.isIgnored(c.path, false)) continue;
        const file = await this.statFile(c.path);
        if (!file) {
          if (this.docs.delete(c.path)) summary.removed.push(c.path);
          continue;
        }
        const existed = this.docs.has(c.path);
        this.docs.set(c.path, await this.load(file));
        if (!this.dirs.has(dirnameRel(c.path))) {
          this.addDirWithAncestors(dirnameRel(c.path));
          summary.directoriesChanged = true;
        }
        (existed ? summary.changed : summary.added).push(c.path);
      }
    }
    // Symlinks pointing at a changed file see new content too.
    const touched = new Set([...summary.changed, ...summary.added]);
    for (const d of this.docs.values()) {
      if (d.symlinkTarget && touched.has(d.symlinkTarget) && !touched.has(d.path)) {
        const file = await this.statFile(d.path);
        if (file) {
          this.docs.set(d.path, await this.load(file));
          summary.changed.push(d.path);
        }
      }
    }
    this.rebuildLinkGraph();
    return summary;
  }

  private addDirWithAncestors(dir: string): void {
    let d = dir;
    while (!this.dirs.has(d)) {
      this.dirs.add(d);
      if (d === '') break;
      d = dirnameRel(d);
    }
  }

  private async statFile(rel: string): Promise<ScannedFile | null> {
    const abs = toAbs(this.root, rel);
    try {
      const real = await this.fs.realpath(abs);
      if (real !== toAbs(this.realRoot, rel)) {
        return statSymlinkedFile(this.fs, this.root, this.realRoot, rel);
      }
      const st = await this.fs.stat(abs);
      return st.isFile ? { path: rel, size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private rebuildLinkGraph(): void {
    const map = new Map<string, Backlink[]>();
    for (const d of this.docs.values()) {
      for (const l of d.doc?.links ?? []) {
        if (l.kind !== 'internal' || !l.target) continue;
        const target = this.resolveDocumentPath(l.target);
        if (!target || target === d.path) continue;
        const entry: Backlink = { from: d.path, line: l.line, text: l.text };
        if (l.fragment !== undefined) entry.fragment = l.fragment;
        const list = map.get(target);
        if (list) list.push(entry);
        else map.set(target, [entry]);
      }
    }
    for (const list of map.values())
      list.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
    this.backlinkMap = map;
  }
}

export { DEFAULT_ROOT_MARKERS };
