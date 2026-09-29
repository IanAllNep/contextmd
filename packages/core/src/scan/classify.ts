import { basenameRel } from '../paths';

/**
 * What role a Markdown file plays for agents.
 * - instructions: always-on instruction files (AGENTS.md, CLAUDE.md, …)
 * - rule:         modular / path-scoped rules (.claude/rules, .cursor/rules, …)
 * - skill:        on-demand skills (SKILL.md)
 * - command:      slash-command prompt files
 * - subagent:     subagent definitions
 * - project-doc:  well-known human docs that agents often read (README, CONTRIBUTING)
 * - doc:          any other Markdown
 */
export type InstructionKind =
  'instructions' | 'rule' | 'skill' | 'command' | 'subagent' | 'project-doc' | 'doc';

export interface RecognizedPattern {
  id: string;
  label: string;
  kind: Exclude<InstructionKind, 'doc'>;
  /** Harness ids that give this file meaning. Informational only. */
  harnesses: readonly string[];
  test(relPath: string, basename: string): boolean;
}

export interface Classification {
  kind: InstructionKind;
  patternId: string | null;
  label: string | null;
  harnesses: readonly string[];
}

const exact =
  (name: string) =>
  (_p: string, base: string): boolean =>
    base === name;
const exactInsensitive =
  (name: string) =>
  (_p: string, base: string): boolean =>
    base.toLowerCase() === name.toLowerCase();
const re =
  (regex: RegExp) =>
  (p: string): boolean =>
    regex.test(p);

/**
 * Recognized filename patterns, checked in order; first match wins.
 * To teach ContextMD about a new convention, add an entry here.
 */
export const RECOGNIZED_PATTERNS: readonly RecognizedPattern[] = [
  {
    id: 'agents-md',
    label: 'AGENTS.md',
    kind: 'instructions',
    harnesses: ['generic', 'codex', 'claude-code'],
    test: exact('AGENTS.md'),
  },
  {
    id: 'agents-override-md',
    label: 'AGENTS.override.md',
    kind: 'instructions',
    harnesses: ['codex'],
    test: exact('AGENTS.override.md'),
  },
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    kind: 'instructions',
    harnesses: ['generic', 'claude-code'],
    test: exact('CLAUDE.md'),
  },
  {
    id: 'claude-local-md',
    label: 'CLAUDE.local.md',
    kind: 'instructions',
    harnesses: ['claude-code'],
    test: exact('CLAUDE.local.md'),
  },
  {
    id: 'gemini-md',
    label: 'GEMINI.md',
    kind: 'instructions',
    harnesses: ['gemini'],
    test: exact('GEMINI.md'),
  },
  {
    id: 'copilot-instructions',
    label: 'Copilot instructions',
    kind: 'instructions',
    harnesses: ['copilot'],
    test: re(/(^|\/)\.github\/copilot-instructions\.md$/),
  },
  {
    id: 'copilot-scoped-instructions',
    label: 'Copilot scoped instructions',
    kind: 'rule',
    harnesses: ['copilot'],
    test: re(/(^|\/)\.github\/instructions\/.+\.instructions\.md$/),
  },
  {
    id: 'claude-rule',
    label: 'Claude rule',
    kind: 'rule',
    harnesses: ['claude-code'],
    test: re(/(^|\/)\.claude\/rules\/.+\.md$/),
  },
  {
    id: 'claude-skill',
    label: 'Claude skill',
    kind: 'skill',
    harnesses: ['claude-code'],
    test: re(/(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/),
  },
  {
    id: 'claude-command',
    label: 'Claude command',
    kind: 'command',
    harnesses: ['claude-code'],
    test: re(/(^|\/)\.claude\/commands\/.+\.md$/),
  },
  {
    id: 'claude-subagent',
    label: 'Claude subagent',
    kind: 'subagent',
    harnesses: ['claude-code'],
    test: re(/(^|\/)\.claude\/agents\/.+\.md$/),
  },
  {
    id: 'cursor-rule',
    label: 'Cursor rule',
    kind: 'rule',
    harnesses: ['cursor'],
    test: re(/(^|\/)\.cursor\/rules\/.+\.mdc?$/),
  },
  { id: 'skill-md', label: 'SKILL.md', kind: 'skill', harnesses: [], test: exact('SKILL.md') },
  {
    id: 'readme',
    label: 'README',
    kind: 'project-doc',
    harnesses: [],
    test: exactInsensitive('README.md'),
  },
  {
    id: 'contributing',
    label: 'CONTRIBUTING',
    kind: 'project-doc',
    harnesses: [],
    test: exactInsensitive('CONTRIBUTING.md'),
  },
];

export function classify(
  relPath: string,
  patterns: readonly RecognizedPattern[] = RECOGNIZED_PATTERNS,
): Classification {
  const base = basenameRel(relPath);
  for (const p of patterns) {
    if (p.test(relPath, base)) {
      return { kind: p.kind, patternId: p.id, label: p.label, harnesses: p.harnesses };
    }
  }
  return { kind: 'doc', patternId: null, label: null, harnesses: [] };
}

/** Kinds that are agent-facing (everything except plain docs and human project docs). */
export function isAgentFacing(kind: InstructionKind): boolean {
  return kind !== 'doc' && kind !== 'project-doc';
}
