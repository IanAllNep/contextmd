import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  analyzeContext,
  buildRegistry,
  loadRepoSpecs,
  loadSpecsFromDir,
  REPO_SPEC_DIR,
  DEFAULT_IGNORED_DIRS,
  exportContext,
  isMarkdownPath,
  normalizeRel,
  renderContext,
  RepositoryIndex,
  toRel,
  type ExportFormat,
  type FileChange,
  type HarnessRegistry,
  type IndexProgress,
  type SearchOptions,
} from '@contextmd/core';
import { NodeFileSystem, toPosix } from '@contextmd/core/node';
import type {
  AdapterInfo,
  ContextRequest,
  ContextResponse,
  DocumentDetail,
  OpenedFile,
  RepoEvent,
  RepoSnapshot,
  SaveResult,
} from '../shared/api';

export const hashContent = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex');

const WATCH_DEBOUNCE_MS = 75;

export class PathError extends Error {}

/**
 * One opened repository: the index, a file watcher that keeps it fresh, and
 * conflict-safe file IO. Everything the renderer asks for goes through here.
 */
export class Workspace {
  private watcher: FSWatcher | null = null;
  private pending: FileChange[] = [];
  private timer: NodeJS.Timeout | null = null;
  private applying: Promise<void> = Promise.resolve();
  private version = 1;
  private indexedAt = Date.now();
  registry: HarnessRegistry = buildRegistry();

  private constructor(
    readonly root: string,
    private readonly realRoot: string,
    readonly index: RepositoryIndex,
    private readonly emit: (e: RepoEvent) => void,
    private readonly userSpecDir: string | null,
  ) {}

  /**
   * @param userSpecDir the user's own harness spec folder (trusted), if any. Repository specs in
   *   `.contextmd/harnesses` are always loaded as untrusted data.
   */
  static async open(
    root: string,
    emit: (e: RepoEvent) => void,
    userSpecDir: string | null = null,
  ): Promise<Workspace> {
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`);
    const realRoot = toPosix(await fsp.realpath(root));
    const index = await RepositoryIndex.open(realRoot, new NodeFileSystem(), {
      onProgress: (progress: IndexProgress) => emit({ type: 'indexing', progress }),
    });
    const ws = new Workspace(realRoot, realRoot, index, emit, userSpecDir);
    await ws.loadHarnesses();
    ws.startWatching();
    return ws;
  }

  /** (Re)loads user and repository harness specs and reclassifies files they name. */
  async loadHarnesses(): Promise<void> {
    const fs = new NodeFileSystem();
    const user = this.userSpecDir
      ? await loadSpecsFromDir(fs, toPosix(this.userSpecDir), 'user', 'your harness folder')
      : { specs: [], problems: [] };
    this.registry = buildRegistry(user, await loadRepoSpecs(this.index));
    this.index.setPatterns(this.registry.patterns);
  }

  get name(): string {
    return basename(this.root);
  }

  snapshot(): RepoSnapshot {
    return {
      root: this.root,
      name: this.name,
      version: this.version,
      files: this.index.summaries(),
      directories: this.index.directories(),
      adapters: this.registry.adapters.map((a) => {
        const det = a.detect(this.index);
        const info: AdapterInfo = {
          id: a.id,
          name: a.name,
          description: a.description,
          fidelity: a.fidelity,
          references: a.references,
          options: a.options,
          origin: a.origin ?? 'builtin',
          detected: det.detected,
          evidence: det.evidence,
        };
        if (a.verifiedOn) info.verifiedOn = a.verifiedOn;
        if (a.command) info.command = a.command;
        if (a.sourceFile) info.sourceFile = a.sourceFile;
        return info;
      }),
      harnessProblems: this.registry.problems,
      scanTruncated: this.index.scanTruncated,
      ignoredCount: this.index.ignoredCount,
      indexedAt: this.indexedAt,
    };
  }

  async reload(): Promise<RepoSnapshot> {
    await this.index.rescan();
    await this.loadHarnesses();
    this.version++;
    this.indexedAt = Date.now();
    return this.snapshot();
  }

  // ------------------------------------------------------------------ paths

  /**
   * Validates a renderer-supplied repo-relative path and returns its absolute path.
   * Rejects traversal and symlinks that resolve outside the repository.
   */
  async resolveInside(rel: string, { mustExist }: { mustExist: boolean }): Promise<string> {
    if (typeof rel !== 'string') throw new PathError('Invalid path');
    const norm = normalizeRel(rel);
    if (norm === null || norm === '') throw new PathError(`Path is outside the repository: ${rel}`);
    const abs = join(this.root, ...norm.split('/'));
    let probe = abs;
    // For files that don't exist yet, check the nearest existing ancestor instead.
    for (;;) {
      try {
        const real = toPosix(await fsp.realpath(probe));
        if (toRel(this.realRoot, real) === null)
          throw new PathError(`Path resolves outside the repository: ${rel}`);
        if (probe !== abs && mustExist) throw new PathError(`File not found: ${rel}`);
        return abs;
      } catch (e) {
        if (e instanceof PathError) throw e;
        const parent = probe.slice(0, probe.lastIndexOf(sep));
        if (parent.length < this.root.length)
          throw new PathError(`Path is outside the repository: ${rel}`);
        probe = parent;
      }
    }
  }

  /** Validates a repo-relative directory ('' = root) and returns its absolute path. */
  async resolveDir(rel: string): Promise<string> {
    if (typeof rel !== 'string') throw new PathError('Invalid path');
    const norm = normalizeRel(rel);
    if (norm === null) throw new PathError(`Path is outside the repository: ${rel}`);
    const abs = norm === '' ? this.root : join(this.root, ...norm.split('/'));
    const real = toPosix(await fsp.realpath(abs));
    if (toRel(this.realRoot, real) === null)
      throw new PathError(`Path resolves outside the repository: ${rel}`);
    if (!(await fsp.stat(real)).isDirectory()) throw new PathError(`Not a directory: ${rel}`);
    return abs;
  }

  // ------------------------------------------------------------------ files

  async readFile(rel: string): Promise<OpenedFile> {
    const abs = await this.resolveInside(rel, { mustExist: true });
    const [content, st] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
    return { path: normalizeRel(rel)!, content, hash: hashContent(content), mtimeMs: st.mtimeMs };
  }

  /**
   * Writes only if the file on disk still matches `baseHash` (the version the editor loaded),
   * unless `force` is set. `baseHash === null` means "the file should not exist".
   */
  async saveFile(
    rel: string,
    content: string,
    baseHash: string | null,
    force: boolean,
  ): Promise<SaveResult> {
    if (!isMarkdownPath(rel))
      return { ok: false, reason: 'error', message: 'Only Markdown files can be saved.' };
    let abs: string;
    try {
      abs = await this.resolveInside(rel, { mustExist: false });
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
    let disk: string | null = null;
    try {
      disk = await fsp.readFile(abs, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        return { ok: false, reason: 'error', message: (e as Error).message };
    }
    const diskHash = disk === null ? null : hashContent(disk);
    if (!force && diskHash !== baseHash)
      return { ok: false, reason: 'conflict', diskHash, diskContent: disk };
    try {
      await fsp.writeFile(abs, content, 'utf8');
      const st = await fsp.stat(abs);
      const path = normalizeRel(rel)!;
      this.enqueue([{ type: disk === null ? 'add' : 'change', path }]);
      return { ok: true, hash: hashContent(content), mtimeMs: st.mtimeMs };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
  }

  async getDocument(rel: string): Promise<DocumentDetail | null> {
    const summary = this.index.summary(rel);
    if (!summary) return null;
    return {
      summary,
      doc: this.index.get(rel)?.doc ?? null,
      backlinks: this.index.backlinks(rel),
      brokenLinks: await this.index.brokenLinks(rel),
    };
  }

  search(query: string, options: SearchOptions) {
    return this.index.search(query, options);
  }

  // ---------------------------------------------------------------- context

  async resolveContext(req: ContextRequest): Promise<ContextResponse> {
    const adapter = this.registry.adapters.find((a) => a.id === req.adapterId);
    if (!adapter) throw new Error(`Unknown adapter: ${req.adapterId}`);
    const cwd = normalizeRel(req.target.cwd ?? '');
    if (cwd === null) throw new PathError('Target is outside the repository');
    const file = req.target.file ? normalizeRel(req.target.file) : null;
    const resolved = await adapter.resolve(this.index, { cwd, file }, req.options);
    return {
      resolved,
      rendered: renderContext(resolved),
      diagnostics: analyzeContext(resolved, {
        experimentalConflicts: req.experimentalConflicts ?? false,
      }),
    };
  }

  async exportContext(req: ContextRequest, format: ExportFormat): Promise<string> {
    const { resolved } = await this.resolveContext(req);
    return exportContext(resolved, format);
  }

  // --------------------------------------------------------------- watching

  private startWatching(): void {
    const ignoredNames = new Set(DEFAULT_IGNORED_DIRS);
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      followSymlinks: false,
      // Wait briefly for writes to settle so we don't read half-written files.
      awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
      ignored: (absPath: string, stats?: { isDirectory(): boolean }) => {
        const rel = toRel(this.root, toPosix(absPath));
        if (rel === null || rel === '') return false;
        if (rel.split('/').some((s) => ignoredNames.has(s))) return true;
        if (!stats) return false;
        return this.index.isIgnored(rel, stats.isDirectory());
      },
    });
    const on = (type: FileChange['type']) => (absPath: string) => {
      const rel = toRel(this.root, toPosix(absPath));
      if (rel === null || rel === '') return;
      // Only Markdown, directories and ignore files affect the index.
      if (
        type === 'addDir' ||
        type === 'unlinkDir' ||
        isMarkdownPath(rel) ||
        rel.endsWith('.gitignore') ||
        rel.startsWith(REPO_SPEC_DIR + '/')
      ) {
        this.enqueue([{ type, path: rel }]);
      }
    };
    this.watcher
      .on('add', on('add'))
      .on('change', on('change'))
      .on('unlink', on('unlink'))
      .on('addDir', on('addDir'))
      .on('unlinkDir', on('unlinkDir'))
      .on('error', (e) =>
        this.emit({ type: 'watch-error', message: e instanceof Error ? e.message : String(e) }),
      );
  }

  private enqueue(changes: FileChange[]): void {
    this.pending.push(...changes);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), WATCH_DEBOUNCE_MS);
  }

  private flush(): void {
    const batch = this.pending.splice(0);
    this.timer = null;
    if (batch.length === 0) return;
    // Serialize batches so the index never sees overlapping updates.
    this.applying = this.applying.then(async () => {
      try {
        const specsChanged = batch.some((c) => c.path.startsWith(REPO_SPEC_DIR + '/'));
        const summary = await this.index.applyChanges(
          batch.filter((c) => !c.path.startsWith(REPO_SPEC_DIR + '/') || c.type.endsWith('Dir')),
        );
        if (specsChanged) await this.loadHarnesses();
        const touched = summary.added.length + summary.changed.length + summary.removed.length;
        if (touched === 0 && !summary.directoriesChanged && !specsChanged) return;
        this.version++;
        this.indexedAt = Date.now();
        this.emit({ type: 'index-changed', snapshot: this.snapshot(), summary });
        this.emit({
          type: 'files-changed',
          changed: [...summary.changed, ...summary.added],
          removed: summary.removed,
        });
      } catch (e) {
        this.emit({ type: 'watch-error', message: (e as Error).message });
      }
    });
  }

  /** Resolves once all queued changes have been applied (used by tests). */
  async settled(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.flush();
    }
    await this.applying;
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
