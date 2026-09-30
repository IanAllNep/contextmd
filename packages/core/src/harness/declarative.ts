import picomatch from 'picomatch';
import YAML from 'yaml';
import { identity, removeLines, truncateBytes, type MappedContent } from '../context/transform';
import type { ContextTarget, LoadTiming, SegmentScope } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import { parseMarkdown } from '../markdown/parse';
import type { LineRange, MarkdownDocument } from '../markdown/types';
import { ancestorChain, basenameRel, dirnameRel, isWithin, joinRel, normalizeRel } from '../paths';
import { isMarkdownPath } from '../scan/ignore';
import { utf8ByteLength } from '../tokens/estimate';
import { ContextBuilder } from './builder';
import { expandAtImports } from './imports';
import type { AdapterOrigin, HarnessAdapter } from './types';
import type { HarnessSpec } from './spec';

const relTo = (path: string, dir: string) => (dir === '' ? path : path.slice(dir.length + 1));

function globsOf(
  doc: MarkdownDocument | null | undefined,
  field: string | undefined,
): string[] | null {
  if (!field) return null;
  const v = doc?.frontmatter?.data?.[field];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
  if (typeof v === 'string' && v.trim() !== '')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return null;
}

/**
 * Builds a HarnessAdapter from a declarative spec. Repository and user specs are marked
 * 'declared' regardless of what they claim; repository specs never get a `command`.
 */
export function createSpecAdapter(
  spec: HarnessSpec,
  origin: AdapterOrigin = 'builtin',
  sourceFile?: string,
): HarnessAdapter {
  const fidelity = origin === 'builtin' ? (spec.fidelity ?? 'declared') : 'declared';
  const adapter: HarnessAdapter = {
    id: spec.id,
    name: spec.name,
    description: spec.description ?? `Declared harness: ${spec.files.join(', ')}`,
    fidelity,
    references: spec.references ?? [],
    options: [],
    origin,

    detect(index) {
      const names = new Set([...spec.files, ...(spec.rootFiles ?? [])].map(basenameRel));
      const evidence = index
        .documents()
        .filter((d) => names.has(basenameRel(d.path)))
        .map((d) => d.path);
      return { detected: evidence.length > 0, evidence };
    },

    async resolve(index: RepositoryIndex, target: ContextTarget) {
      const b = new ContextBuilder(index, adapter, target);
      const file = target.file ?? null;
      const chain = ancestorChain(target.cwd);
      const notRead = 'Outside the opened repository; ContextMD does not read it.';
      for (const g of spec.global ?? []) {
        b.skip(
          { source: { type: 'external', path: g }, scope: 'user', reason: 'Global instructions' },
          notRead,
          'not-read',
        );
      }

      // Project root.
      let root = '';
      if (spec.root) {
        const markers = index.markers();
        const found = [...chain]
          .reverse()
          .find((d) => (markers[d] ?? []).some((m) => spec.root!.markers.includes(m)));
        if (found !== undefined) root = found;
        else if ((spec.root.fallback ?? 'repo-root') === 'cwd') {
          root = target.cwd;
          b.notes.push(
            `No ${spec.root.markers.join(' / ')} found at or above the launch directory inside the opened folder; using the launch directory as the project root.`,
          );
        } else {
          b.notes.push(
            `No ${spec.root.markers.join(' / ')} found inside the opened folder; using the opened folder as the project root.`,
          );
        }
      }
      const fromRoot = chain.filter((d) => isWithin(d, root));

      // Budget shared by all top-level files, in load order.
      let remaining = spec.maxBytes ?? Infinity;
      const transform = (
        doc: MarkdownDocument | null,
        content: string,
        stripFm: boolean,
      ): MappedContent => {
        const ranges: LineRange[] = [];
        if (doc && spec.stripHtmlComments) ranges.push(...doc.htmlComments);
        if (doc && stripFm && doc.frontmatter) ranges.push(doc.frontmatter.range);
        return removeLines(identity(content), ranges);
      };

      /** Loads one file; returns true if it was included (counts as "matched" for perDirectory: first). */
      const load = async (
        path: string,
        init: { scope: SegmentScope; timing: LoadTiming; reason: string; stripFm?: boolean },
      ): Promise<boolean> => {
        const seg = {
          source: { type: 'repo' as const, path },
          scope: init.scope,
          timing: init.timing,
          reason: init.reason,
        };
        if (b.loadedBy(path)) {
          b.skip(seg, 'Already loaded earlier in this context (same file or symlink target).');
          return true;
        }
        const entry = index.get(path);
        const content = entry ? entry.content : await index.readRepoFile(path);
        if (content === null || content === undefined) {
          b.skip(seg, entry?.error ?? 'Could not be read by ContextMD.');
          return false;
        }
        if (spec.skipEmpty && content.trim() === '') {
          b.skip(seg, 'Empty file: skipped.');
          return false;
        }
        const size = entry?.size ?? utf8ByteLength(content);
        if (spec.maxFileBytes && size > spec.maxFileBytes) {
          b.skip(seg, `Larger than the ${spec.maxFileBytes}-byte per-file limit.`);
          return true;
        }
        if (remaining <= 0) {
          b.skip(seg, `The combined ${spec.maxBytes}-byte budget is already used up.`);
          return true;
        }
        const doc =
          entry?.doc ??
          (isMarkdownPath(path)
            ? parseMarkdown(path, content, { estimator: index.estimator })
            : null);
        let mapped = transform(doc, content, init.stripFm ?? false);
        const bytes = utf8ByteLength(mapped.content);
        let truncated: string | undefined;
        if (bytes > remaining) {
          if (spec.overflow === 'skip') {
            b.skip(seg, `Does not fit in the remaining ${remaining} of ${spec.maxBytes} bytes.`);
            return true;
          }
          mapped = truncateBytes(mapped, remaining);
          truncated = `Truncated to the remaining ${remaining} of ${spec.maxBytes} bytes.`;
          remaining = 0;
        } else {
          remaining -= bytes;
        }
        const s = b.include(seg, mapped, truncated);
        if (doc && spec.stripHtmlComments && doc.htmlComments.length > 0) {
          s.warnings.push(`${doc.htmlComments.length} block-level HTML comment(s) stripped.`);
        }
        const im = spec.imports;
        if (doc && im && (!im.in || im.in.includes(basenameRel(path)))) {
          await expandAtImports(index, b, s, doc, 1, {
            maxDepth: im.maxDepth,
            transform: (d, c) => transform(d, c, false),
          });
        }
        return true;
      };

      const loadDirectory = async (dir: string, timing: LoadTiming) => {
        const where = dir === '' ? 'repository root' : `/${dir}`;
        const scope: SegmentScope = dir === root ? 'project' : 'directory';
        const reason =
          timing === 'launch'
            ? `Checked in ${where}`
            : `On demand: the agent reads a file under ${where}`;
        const candidates = [...spec.files, ...(dir === root ? (spec.rootFiles ?? []) : [])];
        let chosen: string | null = null;
        for (const name of candidates) {
          const path = joinRel(dir, name);
          if (!index.has(path)) continue;
          if (chosen && spec.perDirectory === 'first') {
            b.skip(
              { source: { type: 'repo', path }, scope, timing, reason },
              `At most one file per directory; ${basenameRel(chosen)} takes precedence.`,
            );
            continue;
          }
          if (await load(path, { scope, timing, reason })) chosen = path;
        }
      };

      // Launch-time directories.
      const traversal = spec.traversal ?? 'root-to-cwd';
      let dirs: string[];
      if (traversal === 'cwd-only') dirs = [target.cwd];
      else if (traversal === 'root-only') dirs = [root];
      else if (traversal === 'nearest') {
        const names = [...spec.files, ...(spec.rootFiles ?? [])];
        const nearest = [...fromRoot]
          .reverse()
          .find((d) => names.some((n) => index.has(joinRel(d, n))));
        dirs = nearest === undefined ? [] : [nearest];
      } else dirs = fromRoot;
      for (const d of dirs) await loadDirectory(d, 'launch');

      // Conditional rules.
      for (const rule of spec.rules ?? []) {
        const matches = index
          .documents()
          .filter(
            (d) =>
              isWithin(d.path, root) &&
              picomatch.isMatch(relTo(d.path, root), rule.glob, { dot: true }),
          );
        for (const d of matches) {
          const always = rule.alwaysField
            ? d.doc?.frontmatter?.data?.[rule.alwaysField] === true
            : false;
          const globs = globsOf(d.doc, rule.globsField);
          const seg = { source: { type: 'repo' as const, path: d.path }, scope: 'rule' as const };
          const stripFm = rule.stripFrontmatter ?? true;
          if (always || (globs === null && (rule.default ?? 'always') === 'always')) {
            await load(d.path, {
              scope: 'rule',
              timing: 'launch',
              reason: always ? `Rule with ${rule.alwaysField}: true` : 'Rule without file globs',
              stripFm,
            });
          } else if (
            globs &&
            file &&
            isWithin(file, root) &&
            picomatch.isMatch(relTo(file, root), globs, { dot: true })
          ) {
            await load(d.path, {
              scope: 'rule',
              timing: 'on-demand',
              reason: `Rule globs match /${file}`,
              stripFm,
            });
          } else if (globs) {
            b.skip(
              { ...seg, timing: 'on-demand', reason: `Scoped rule (${globs.join(', ')})` },
              file
                ? `Does not match the working file /${file}.`
                : 'Loads only for matching files. Set a working file to evaluate.',
            );
          } else {
            b.skip(
              { ...seg, timing: 'on-demand', reason: 'Rule without globs' },
              'Applied only when the agent decides it is relevant.',
            );
          }
        }
      }

      // Config files that list extra files to read.
      for (const cfg of spec.configReads ?? []) {
        for (const dir of [...new Set([root, target.cwd])]) {
          const cfgPath = joinRel(dir, cfg.file);
          const text = await index.readRepoFile(cfgPath);
          if (text === null) continue;
          let data: unknown;
          try {
            data = YAML.parse(text);
          } catch {
            b.notes.push(`/${cfgPath} could not be parsed.`);
            continue;
          }
          const v =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)[cfg.key]
              : undefined;
          const list =
            typeof v === 'string'
              ? [v]
              : Array.isArray(v)
                ? v.filter((x): x is string => typeof x === 'string')
                : [];
          for (const item of list) {
            const rel = normalizeRel(joinRel(dir, item));
            const reason = `Listed under "${cfg.key}" in /${cfgPath}`;
            if (rel === null || item.startsWith('/') || item.startsWith('~')) {
              b.skip(
                { source: { type: 'external', path: item }, scope: 'project', reason },
                'Outside the opened repository; not read.',
                'not-read',
              );
            } else if (!(await index.exists(rel))) {
              b.skip(
                { source: { type: 'repo', path: rel }, scope: 'project', reason },
                'File not found.',
              );
            } else {
              await load(rel, { scope: 'project', timing: 'launch', reason });
            }
          }
        }
      }

      // On-demand directories between the launch directory and the working file.
      if (spec.onDemand && file) {
        const fileDir = dirnameRel(file);
        if (isWithin(fileDir, target.cwd) && fileDir !== target.cwd) {
          for (const d of ancestorChain(fileDir).filter(
            (d) => d !== target.cwd && isWithin(d, target.cwd),
          )) {
            await loadDirectory(d, 'on-demand');
          }
        }
      }

      if (!spec.root || (spec.root.fallback ?? 'repo-root') === 'repo-root') {
        if (traversal === 'root-to-cwd' || traversal === 'nearest') {
          b.notes.push('Directories above the opened folder are not inspected.');
        }
      }
      if (spec.imports) b.notes.push('Imported files are listed after the file that imports them.');
      if (origin !== 'builtin') {
        b.notes.push(
          `Declared by ${origin === 'repository' ? 'this repository' : 'you'}${sourceFile ? ` in ${sourceFile}` : ''}. ContextMD has not verified that the agent behaves this way.`,
        );
      }
      b.notes.push(...(spec.notes ?? []));
      return b.finish();
    },
  };
  if (spec.verifiedOn && origin === 'builtin') adapter.verifiedOn = spec.verifiedOn;
  if (spec.command && origin !== 'repository') adapter.command = spec.command;
  if (sourceFile) adapter.sourceFile = sourceFile;
  return adapter;
}
