import { identity, truncateBytes } from '../context/transform';
import type { ContextTarget } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import { ancestorChain, joinRel } from '../paths';
import { utf8ByteLength } from '../tokens/estimate';
import { ContextBuilder } from './builder';
import { optionValue, type AdapterOptions, type HarnessAdapter } from './types';

/** Documented default for `project_doc_max_bytes`. */
export const CODEX_DEFAULT_MAX_BYTES = 32 * 1024;
const PRIMARY_NAMES = ['AGENTS.override.md', 'AGENTS.md'] as const;
const ROOT_MARKERS = ['.git'];

/**
 * OpenAI Codex CLI AGENTS.md discovery, per the Codex AGENTS.md guide and config reference
 * (checked 2026-09-29):
 *  - walk from the project root (nearest ancestor with `.git`) down to the working directory
 *  - per directory: AGENTS.override.md, else AGENTS.md, else fallback names; at most one file
 *  - empty (whitespace-only) files are skipped
 *  - stop adding once the combined size reaches project_doc_max_bytes (32 KiB); the file that
 *    crosses the limit is truncated
 */
export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  name: 'Codex CLI',
  description:
    'AGENTS.override.md / AGENTS.md from the project root down to the working directory, one file per directory, 32 KiB combined budget.',
  fidelity: 'documented',
  references: [
    {
      title: 'Codex: Custom instructions with AGENTS.md',
      url: 'https://developers.openai.com/codex/guides/agents-md',
    },
    {
      title: 'Codex: Advanced configuration',
      url: 'https://developers.openai.com/codex/config-advanced',
    },
  ],
  verifiedOn: '2026-09-29',
  options: [
    {
      id: 'maxBytes',
      label: 'project_doc_max_bytes',
      description: 'Combined byte budget for project AGENTS.md files.',
      type: 'number',
      default: CODEX_DEFAULT_MAX_BYTES,
    },
    {
      id: 'fallbackFilenames',
      label: 'project_doc_fallback_filenames',
      description: 'Comma-separated extra filenames checked after AGENTS.md in each directory.',
      type: 'text',
      default: '',
    },
  ],

  detect(index) {
    const evidence = index
      .documents()
      .filter(
        (d) =>
          d.classification.patternId === 'agents-md' ||
          d.classification.patternId === 'agents-override-md',
      )
      .map((d) => d.path);
    return { detected: evidence.length > 0, evidence };
  },

  async resolve(index: RepositoryIndex, target: ContextTarget, options?: AdapterOptions) {
    const b = new ContextBuilder(index, this, target);
    const maxBytes =
      Number(optionValue<number>(this, options, 'maxBytes')) || CODEX_DEFAULT_MAX_BYTES;
    const fallbacks = String(optionValue<string>(this, options, 'fallbackFilenames') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const names = [...PRIMARY_NAMES, ...fallbacks];

    b.skip(
      {
        source: {
          type: 'external',
          path: '$CODEX_HOME/AGENTS.override.md or AGENTS.md (~/.codex)',
        },
        scope: 'user',
        reason: 'Global instructions, loaded before project files',
      },
      'Outside the opened repository; ContextMD does not read it.',
      'not-read',
    );

    const chain = ancestorChain(target.cwd);
    const markers = index.markers();
    let rootIdx = -1;
    for (let i = chain.length - 1; i >= 0; i--) {
      if ((markers[chain[i]!] ?? []).some((m) => ROOT_MARKERS.includes(m))) {
        rootIdx = i;
        break;
      }
    }
    let dirs: string[];
    if (rootIdx === -1) {
      dirs = [target.cwd];
      b.notes.push(
        'No .git directory found at or above the working directory inside the opened folder. Codex then checks only the working directory. If the folder sits inside a larger git repository, Codex would start at that repository root instead.',
      );
    } else {
      dirs = chain.slice(rootIdx);
      if (rootIdx > 0)
        b.notes.push(`Project root is /${chain[rootIdx]} (nearest directory containing .git).`);
    }

    let remaining = maxBytes;
    for (const dir of dirs) {
      const where = dir === '' ? 'repository root' : `/${dir}`;
      const scope = dir === dirs[0] ? 'project' : 'directory';
      const reason = `Directory on the path from project root to working directory (${where})`;
      let chosen: string | null = null;
      for (const name of names) {
        const path = joinRel(dir, name);
        const entry = index.get(path);
        if (!entry) continue;
        const seg = {
          source: { type: 'repo' as const, path },
          scope: scope as 'project' | 'directory',
          reason,
        };
        if (chosen) {
          b.skip(
            seg,
            `Codex includes at most one file per directory; ${chosen.split('/').pop()} takes precedence.`,
          );
          continue;
        }
        if (entry.content === null) {
          b.skip(seg, entry.error ?? 'Could not be read by ContextMD.');
          continue;
        }
        if (entry.content.trim() === '') {
          b.skip(seg, 'Empty file: Codex skips it.');
          continue;
        }
        chosen = path;
        if (remaining <= 0) {
          b.skip(
            seg,
            `The combined project_doc_max_bytes budget (${maxBytes} bytes) is already used up.`,
          );
          continue;
        }
        const bytes = utf8ByteLength(entry.content);
        if (bytes > remaining) {
          b.include(
            seg,
            truncateBytes(identity(entry.content), remaining),
            `Truncated to the remaining ${remaining} of ${maxBytes} bytes (project_doc_max_bytes).`,
          );
          remaining = 0;
        } else {
          b.include(seg, identity(entry.content));
          remaining -= bytes;
        }
      }
    }
    if (target.file) {
      b.notes.push(
        'Codex reads AGENTS.md files for the working directory when a session starts. Per its docs, the file being edited does not change which files load.',
      );
    }
    b.notes.push('Codex skips project AGENTS.md files entirely in projects it does not trust.');
    return b.finish();
  },
};
