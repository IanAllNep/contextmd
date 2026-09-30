import { identity, type MappedContent } from '../context/transform';
import type { ContextSegment } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import { parseMarkdown } from '../markdown/parse';
import type { MarkdownDocument } from '../markdown/types';
import { dirnameRel, joinRel, normalizeRel, toRel } from '../paths';
import { isMarkdownPath } from '../scan/ignore';
import type { ContextBuilder } from './builder';

export interface AtImportOptions {
  /** Maximum hops from the top-level file (1 = direct imports only). */
  maxDepth: number;
  /** How imported Markdown is transformed before injection (e.g. stripping comments). */
  transform?: (doc: MarkdownDocument, content: string) => MappedContent;
  /** Harness-specific warnings for an import target. */
  warn?: (rel: string) => string[];
}

/**
 * Expands `@path` references (Claude Code / Gemini CLI / Amp syntax) into imported segments.
 * Paths resolve relative to the importing file. `~/` and out-of-repo paths are listed as
 * not read. Each file is loaded at most once.
 */
export async function expandAtImports(
  index: RepositoryIndex,
  b: ContextBuilder,
  parent: ContextSegment,
  doc: MarkdownDocument,
  hop: number,
  opts: AtImportOptions,
): Promise<void> {
  if (parent.source.type !== 'repo') return;
  const fromPath = parent.source.path;
  for (const ref of doc.atReferences) {
    const via = { segmentId: parent.id, path: fromPath, line: ref.line };
    const base = {
      scope: 'imported' as const,
      timing: parent.timing,
      reason: `Imported by ${ref.raw} at /${fromPath}:${ref.line}`,
      depth: hop,
      via,
    };
    let rel: string | null;
    if (ref.path.startsWith('~/')) {
      b.skip(
        { ...base, source: { type: 'external', path: ref.path } },
        'Home-directory import: outside the opened repository, not read by ContextMD.',
        'not-read',
      );
      continue;
    } else if (ref.path.startsWith('/')) {
      rel = toRel(index.root, ref.path);
    } else {
      rel = normalizeRel(joinRel(dirnameRel(fromPath), ref.path));
    }
    if (rel === null) {
      b.skip(
        { ...base, source: { type: 'external', path: ref.path } },
        'Resolves outside the opened repository; not read by ContextMD.',
        'not-read',
      );
      continue;
    }
    const source = { type: 'repo' as const, path: rel };
    if (hop > opts.maxDepth) {
      b.skip({ ...base, source }, `Exceeds the maximum import depth of ${opts.maxDepth} hops.`);
      continue;
    }
    if (b.loadedBy(rel)) {
      b.skip({ ...base, source }, 'Already loaded earlier in this context.');
      continue;
    }
    const indexed = index.get(rel);
    const content = indexed?.content ?? (await index.readRepoFile(rel));
    if (content === null) {
      b.skip({ ...base, source }, 'No file at this path, so this @-reference is not an import.');
      continue;
    }
    const warnings = opts.warn?.(rel) ?? [];
    if (isMarkdownPath(rel)) {
      const parsed = indexed?.doc ?? parseMarkdown(rel, content, { estimator: index.estimator });
      const mapped = opts.transform ? opts.transform(parsed, content) : identity(content);
      const s = b.include({ ...base, source, warnings }, mapped);
      await expandAtImports(index, b, s, parsed, hop + 1, opts);
    } else {
      b.include({ ...base, source, warnings }, identity(content));
    }
  }
}
