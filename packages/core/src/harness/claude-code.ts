import picomatch from 'picomatch';
import { identity, removeLines, type MappedContent } from '../context/transform';
import type { ContextTarget, LoadTiming, SegmentScope } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import type { LineRange, MarkdownDocument } from '../markdown/types';
import { ancestorChain, basenameRel, dirnameRel, isWithin, joinRel } from '../paths';
import { ContextBuilder } from './builder';
import { expandAtImports } from './imports';
import { optionValue, type AdapterOptions, type HarnessAdapter } from './types';

/** Documented: "Imported files can recursively import other files, with a maximum depth of four hops." */
export const CLAUDE_MAX_IMPORT_HOPS = 4;
/** Documented: "Claude Code loads a CLAUDE.md file of up to 4 MiB in full and skips a larger file." */
export const CLAUDE_MAX_FILE_BYTES = 4 * 1024 * 1024;

type InstructionMode = 'claude-md-or-agents-md' | 'claude-md-and-agents-md' | 'claude-md';

const claudeFiles = (dir: string) => [joinRel(dir, 'CLAUDE.md'), joinRel(dir, '.claude/CLAUDE.md')];
const localFile = (dir: string) => joinRel(dir, 'CLAUDE.local.md');
const agentsFiles = (dir: string) => [joinRel(dir, 'AGENTS.md'), joinRel(dir, '.claude/AGENTS.md')];

/** Directory an instruction file belongs to: `a/.claude/CLAUDE.md` belongs to `a`. */
function ownerDir(path: string): string {
  const d = dirnameRel(path);
  return basenameRel(d) === '.claude' ? dirnameRel(d) : d;
}

function rulesIn(index: RepositoryIndex, dir: string): string[] {
  const prefix = joinRel(dir, '.claude/rules') + '/';
  return index
    .documents()
    .filter((d) => d.path.startsWith(prefix) && d.path.toLowerCase().endsWith('.md'))
    .map((d) => d.path);
}

/** `paths` frontmatter: YAML list or comma-separated string. Null = unconditional rule. */
export function rulePathGlobs(doc: MarkdownDocument | null | undefined): string[] | null {
  const fm = doc?.frontmatter;
  if (!fm || fm.error || !fm.data) return null; // unparseable frontmatter → loads as if no paths
  const v = fm.data['paths'];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return null;
}

interface Ctx {
  index: RepositoryIndex;
  b: ContextBuilder;
  target: ContextTarget;
}

function hasAnyClaudeFile(index: RepositoryIndex, dirs: string[]): boolean {
  return dirs.some((d) => [...claudeFiles(d), localFile(d)].some((p) => index.has(p)));
}

/** Content as Claude Code injects it: block-level HTML comments stripped, rule frontmatter removed. */
function transformed(
  doc: MarkdownDocument,
  content: string,
  stripFrontmatter: boolean,
): MappedContent {
  const ranges: LineRange[] = [...doc.htmlComments];
  if (stripFrontmatter && doc.frontmatter) ranges.push(doc.frontmatter.range);
  return removeLines(identity(content), ranges);
}

async function loadFile(
  ctx: Ctx,
  path: string,
  init: { scope: SegmentScope; timing: LoadTiming; reason: string; isRule?: boolean },
): Promise<void> {
  const { index, b } = ctx;
  const source = { type: 'repo' as const, path };
  const seg = { source, scope: init.scope, timing: init.timing, reason: init.reason };
  const already = b.loadedBy(path);
  if (already) {
    b.skip(seg, 'Already loaded earlier in this context (same file or symlink target).');
    return;
  }
  const entry = index.get(path);
  if (!entry) return;
  if (entry.size > CLAUDE_MAX_FILE_BYTES) {
    b.skip(seg, 'Claude Code skips instruction files larger than 4 MiB.');
    return;
  }
  if (!entry.doc || entry.content === null) {
    b.skip(seg, entry.error ?? 'Could not be read by ContextMD.');
    return;
  }
  const s = b.include(seg, transformed(entry.doc, entry.content, init.isRule ?? false));
  if (entry.doc.htmlComments.length > 0) {
    s.warnings.push(
      `${entry.doc.htmlComments.length} block-level HTML comment(s) stripped (not sent to Claude).`,
    );
  }
  await expandAtImports(index, b, s, entry.doc, 1, {
    maxDepth: CLAUDE_MAX_IMPORT_HOPS,
    transform: (d, c) => transformed(d, c, false),
    warn: (rel) =>
      isWithin(rel, ctx.target.cwd)
        ? []
        : [
            'Outside the working directory: Claude Code asks for approval before loading external imports.',
          ],
  });
}

/**
 * Claude Code memory semantics, per https://code.claude.com/docs/en/memory (checked 2026-09-29).
 * Anything not stated in the documentation is surfaced as a note instead of guessed silently.
 */
export const claudeCodeAdapter: HarnessAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  description:
    'CLAUDE.md, CLAUDE.local.md, .claude/rules and AGENTS.md loading as documented for Claude Code: ancestors of the launch directory at startup, subdirectories on demand, @imports up to 4 hops.',
  fidelity: 'documented',
  references: [
    {
      title: 'Claude Code: How Claude remembers your project',
      url: 'https://code.claude.com/docs/en/memory',
    },
  ],
  verifiedOn: '2026-09-29',
  command: 'claude',
  options: [
    {
      id: 'instructionFiles',
      label: 'Project instructions',
      description:
        'The "Project instructions" setting (/config) that controls whether AGENTS.md is read.',
      type: 'select',
      choices: [
        { value: 'claude-md-or-agents-md', label: 'CLAUDE.md, or AGENTS.md if none (default)' },
        { value: 'claude-md-and-agents-md', label: 'CLAUDE.md and AGENTS.md' },
        { value: 'claude-md', label: 'CLAUDE.md only' },
      ],
      default: 'claude-md-or-agents-md',
    },
  ],

  detect(index) {
    const evidence = index
      .documents()
      .filter(
        (d) =>
          d.classification.harnesses.includes('claude-code') &&
          d.classification.patternId !== 'agents-md',
      )
      .map((d) => d.path);
    return { detected: evidence.length > 0, evidence };
  },

  async resolve(index: RepositoryIndex, target: ContextTarget, options?: AdapterOptions) {
    const mode = optionValue<InstructionMode>(this, options, 'instructionFiles');
    const b = new ContextBuilder(index, this, target);
    const ctx: Ctx = { index, b, target };
    const chain = ancestorChain(target.cwd);
    const file = target.file ?? null;

    // Sources outside the repository that Claude Code would also consider.
    const notRead = 'Outside the opened repository; ContextMD does not read it.';
    b.skip(
      {
        source: { type: 'external', path: 'Managed policy CLAUDE.md' },
        scope: 'policy',
        reason: 'Organization-wide managed instructions (loaded first)',
      },
      notRead,
      'not-read',
    );
    b.skip(
      {
        source: { type: 'external', path: '~/.claude/CLAUDE.md' },
        scope: 'user',
        reason: 'User instructions for all projects',
      },
      notRead,
      'not-read',
    );
    b.skip(
      {
        source: { type: 'external', path: '~/.claude/rules/' },
        scope: 'user',
        reason: 'User-level rules (loaded before project rules)',
      },
      notRead,
      'not-read',
    );

    const claudePresent = hasAnyClaudeFile(index, chain);
    const readAgents =
      mode === 'claude-md-and-agents-md' || (mode === 'claude-md-or-agents-md' && !claudePresent);
    const agentsSkipReason =
      mode === 'claude-md'
        ? 'Project instructions is set to "CLAUDE.md only".'
        : 'A CLAUDE.md or CLAUDE.local.md exists in the working directory or above, so AGENTS.md is not read (default setting).';

    const deferred: (() => Promise<void>)[] = [];
    const loadDirectory = async (
      dir: string,
      timing: LoadTiming,
      readAgentsHere: boolean,
      agentsSkip: string,
    ) => {
      const where = dir === '' ? 'repository root' : `/${dir}`;
      const scope: SegmentScope = dir === '' ? 'project' : 'directory';
      const reason =
        timing === 'launch'
          ? `Launch: ${where} is the working directory or above it`
          : `On demand: Claude reads a file under ${where}`;
      for (const p of claudeFiles(dir))
        if (index.has(p)) await loadFile(ctx, p, { scope, timing, reason });
      for (const p of rulesIn(index, dir)) {
        const globs = rulePathGlobs(index.get(p)?.doc);
        const ruleSeg = { source: { type: 'repo' as const, path: p }, scope: 'rule' as const };
        if (globs === null) {
          await loadFile(ctx, p, {
            scope: 'rule',
            timing,
            reason: `Rule without paths: loads with ${where}`,
            isRule: true,
          });
          continue;
        }
        const relFile =
          file && isWithin(file, dir) ? (dir === '' ? file : file.slice(dir.length + 1)) : null;
        if (relFile && picomatch.isMatch(relFile, globs, { dot: true })) {
          // Path-scoped rules load when the file is read, i.e. after launch-time context.
          deferred.push(() =>
            loadFile(ctx, p, {
              scope: 'rule',
              timing: 'on-demand',
              reason: `Path-scoped rule: paths match /${file}`,
              isRule: true,
            }),
          );
        } else {
          b.skip(
            {
              ...ruleSeg,
              timing: 'on-demand',
              reason: `Path-scoped rule (paths: ${globs.join(', ')})`,
            },
            file
              ? `Does not match the working file /${file}.`
              : 'Loads only when Claude reads a matching file. Set a working file to evaluate.',
          );
        }
      }
      if (index.has(localFile(dir)))
        await loadFile(ctx, localFile(dir), { scope: 'local', timing, reason });
      for (const p of agentsFiles(dir)) {
        if (!index.has(p)) continue;
        if (readAgentsHere) await loadFile(ctx, p, { scope, timing, reason });
        else if (b.loadedBy(p))
          b.skip(
            { source: { type: 'repo', path: p }, scope, timing, reason },
            'Not read directly, but its content is already included through an @import.',
          );
        else b.skip({ source: { type: 'repo', path: p }, scope, timing, reason }, agentsSkip);
      }
    };

    // Launch: root → cwd.
    for (const dir of chain) await loadDirectory(dir, 'launch', readAgents, agentsSkipReason);

    // On demand: directories between cwd and the working file.
    if (file) {
      const fileDir = dirnameRel(file);
      if (isWithin(fileDir, target.cwd) && fileDir !== target.cwd) {
        const below = ancestorChain(fileDir).filter(
          (d) => d !== target.cwd && isWithin(d, target.cwd),
        );
        for (const dir of below) {
          const ownClaude = hasAnyClaudeFile(index, [dir]);
          const agentsHere =
            mode === 'claude-md-and-agents-md' ||
            (mode === 'claude-md-or-agents-md' && !claudePresent && !ownClaude);
          const skip =
            mode === 'claude-md'
              ? agentsSkipReason
              : ownClaude
                ? 'This directory has its own CLAUDE.md, so its AGENTS.md is not read.'
                : agentsSkipReason;
          await loadDirectory(dir, 'on-demand', agentsHere, skip);
        }
      } else if (!isWithin(file, target.cwd)) {
        b.notes.push(
          `The working file /${file} is outside the launch directory; on-demand loading is not modelled for it.`,
        );
      }
    }
    for (const load of deferred) await load();
    if (!file) {
      const nested = index
        .documents()
        .filter(
          (d) =>
            /(^|\/)(CLAUDE|CLAUDE\.local|AGENTS)\.md$/.test(d.path) &&
            isWithin(d.path, target.cwd) &&
            !chain.includes(ownerDir(d.path)),
        ).length;
      if (nested > 0) {
        b.notes.push(
          `${nested} instruction file(s) in subdirectories load on demand when Claude reads files there. Set a working file to include them.`,
        );
      }
    }

    if (chain.length > 0) {
      b.notes.push(
        'Claude Code also loads CLAUDE.md files in directories above the opened folder (up to the filesystem root). Those are not inspected.',
      );
    }
    b.notes.push(
      'Imported files are listed after the file that imports them. The docs say imports are "expanded", but they don\'t say exactly where the imported text is placed.',
      'Order within one directory is CLAUDE.md, .claude/CLAUDE.md, unconditional rules, CLAUDE.local.md, then AGENTS.md. The docs state that CLAUDE.local.md comes last among the CLAUDE files and that AGENTS.md comes after CLAUDE.md. The position of rules is inferred.',
    );
    return b.finish();
  },
};
