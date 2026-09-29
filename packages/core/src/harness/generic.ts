import type { ContextTarget } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import { ancestorChain, dirnameRel, joinRel } from '../paths';
import { ContextBuilder } from './builder';
import type { HarnessAdapter } from './types';

/** Instruction filenames the generic model looks for in each directory, in order. */
export const GENERIC_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

/**
 * ContextMD's own, tool-neutral approximation of hierarchical instructions:
 * from the repository root down to the target directory, collect well-known
 * instruction files in each directory; then append the target document itself.
 *
 * This is deliberately NOT any specific tool's behavior.
 */
export const genericAdapter: HarnessAdapter = {
  id: 'generic',
  name: 'Generic',
  description:
    'Tool-neutral model: AGENTS.md / CLAUDE.md / GEMINI.md in every directory from the repository root to the target, then the target document. Not the behavior of any specific agent.',
  fidelity: 'heuristic',
  references: [],
  options: [],

  detect(index) {
    const evidence = index
      .documents()
      .filter((d) => d.classification.kind === 'instructions')
      .map((d) => d.path);
    return { detected: evidence.length > 0, evidence };
  },

  async resolve(index: RepositoryIndex, target: ContextTarget) {
    const b = new ContextBuilder(index, this, target);
    const file = target.file ?? null;
    const leafDir = file ? dirnameRel(file) : target.cwd;
    const chain = ancestorChain(leafDir);

    for (const dir of chain) {
      for (const name of GENERIC_INSTRUCTION_FILES) {
        const path = joinRel(dir, name);
        if (!index.has(path)) continue;
        const scope = dir === '' ? 'project' : 'directory';
        const reason =
          dir === ''
            ? 'Instruction file at repository root'
            : `Instruction file in ancestor directory /${dir}`;
        const already = b.loadedBy(path);
        if (already) {
          b.skip(
            { source: { type: 'repo', path }, scope, reason },
            `Same file as an already included source (symlink).`,
          );
          continue;
        }
        const content = b.content(path);
        if (!content) {
          b.skip(
            { source: { type: 'repo', path }, scope, reason },
            index.get(path)?.error ?? 'Unreadable',
          );
          continue;
        }
        b.include({ source: { type: 'repo', path }, scope, reason }, content);
      }
    }

    if (file && index.has(file) && !b.loadedBy(file)) {
      const content = b.content(file);
      if (content) {
        b.include(
          { source: { type: 'repo', path: file }, scope: 'target', reason: 'Target document' },
          content,
        );
      }
    }

    b.notes.push(
      'Generic resolution is a ContextMD heuristic. Real agents differ: pick a harness adapter to see tool-specific behavior.',
    );
    return b.finish();
  },
};
