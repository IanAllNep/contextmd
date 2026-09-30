import type { HarnessSpec } from './spec';

/*
 * Built-in declarative harnesses for terminal agents. Each was checked against the vendor's
 * documentation on the date in `verifiedOn`; see docs/harness-semantics.md. Anything the
 * documentation leaves open is stated in `notes` and shown with every resolution.
 */

export const geminiCliSpec: HarnessSpec = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  description:
    'GEMINI.md from the git root down to the launch directory (all configured names per directory), subdirectories just in time, @imports up to 5 levels.',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [
    {
      title: 'Gemini CLI: GEMINI.md context files',
      url: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md',
    },
    {
      title: 'Gemini CLI: memory import processor',
      url: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/memport.md',
    },
  ],
  command: 'gemini',
  global: ['~/.gemini/GEMINI.md'],
  root: { markers: ['.git'], fallback: 'repo-root' },
  traversal: 'root-to-cwd',
  files: ['GEMINI.md'],
  perDirectory: 'all',
  onDemand: true,
  imports: { syntax: 'at', maxDepth: 5 },
  notes: [
    'Uses the default context file name. `context.fileName` can add others, such as AGENTS.md; every configured name loads in each directory.',
    'Without a .git directory, the docs and the source disagree on how far up Gemini searches.',
    'Gemini wraps each file in "--- Context from: <path> ---" markers, which are not counted here.',
  ],
};

export const ampSpec: HarnessSpec = {
  id: 'amp',
  name: 'Amp',
  description:
    'AGENTS.md (falling back to AGENT.md or CLAUDE.md) in the launch directory and its parents, subtrees on demand, @-mentions.',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [{ title: 'Amp: AGENTS.md', url: 'https://ampcode.com/docs/customize/agents-md' }],
  command: 'amp',
  global: [
    '~/.config/amp/AGENTS.md',
    '~/.config/AGENTS.md',
    'System AGENTS.md (/etc/ampcode, /Library/Application Support/ampcode)',
  ],
  traversal: 'root-to-cwd',
  files: ['AGENTS.md', 'AGENT.md', 'CLAUDE.md'],
  perDirectory: 'first',
  onDemand: true,
  imports: { syntax: 'at', maxDepth: 5 },
  notes: [
    'Amp walks parent directories up to $HOME. Only the part inside the opened folder is shown.',
    'The priority between AGENT.md and CLAUDE.md and the output order are not documented.',
    'Import depth is not documented; ContextMD expands up to 5 levels. Glob @-mentions and `globs` frontmatter on mentioned files are not modelled.',
  ],
};

export const copilotCliSpec: HarnessSpec = {
  id: 'copilot-cli',
  name: 'GitHub Copilot CLI',
  description:
    '.github/copilot-instructions.md, scoped .instructions.md files, and AGENTS.md / CLAUDE.md / GEMINI.md from the repository root to the launch directory, combined.',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [
    {
      title: 'Copilot CLI: custom instructions',
      url: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions',
    },
  ],
  command: 'copilot',
  global: ['~/.copilot/copilot-instructions.md', '~/.copilot/instructions/**/*.instructions.md'],
  root: { markers: ['.git'], fallback: 'repo-root' },
  traversal: 'root-to-cwd',
  files: ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md'],
  rootFiles: ['.github/copilot-instructions.md'],
  perDirectory: 'all',
  onDemand: true,
  rules: [
    { glob: '.github/instructions/**/*.instructions.md', globsField: 'applyTo', default: 'skip' },
  ],
  notes: [
    'Copilot CLI "does not define a general precedence order" between these files, so the order shown is ContextMD\'s.',
    'File references in AGENTS.md and CLAUDE.md are expanded by Copilot, but the syntax and depth are not documented, so they are not expanded here.',
  ],
};

export const openCodeSpec: HarnessSpec = {
  id: 'opencode',
  name: 'OpenCode',
  description:
    'The nearest AGENTS.md (or CLAUDE.md if there is none), found by walking up from the launch directory.',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [{ title: 'OpenCode: Rules', url: 'https://opencode.ai/docs/rules/' }],
  command: 'opencode',
  global: ['~/.config/opencode/AGENTS.md', '~/.claude/CLAUDE.md (if no global AGENTS.md)'],
  traversal: 'nearest',
  files: ['AGENTS.md', 'CLAUDE.md'],
  perDirectory: 'first',
  notes: [
    'The docs say "the first matching file wins" but do not say where the upward walk stops, or whether files in several ancestors are combined. ContextMD shows the nearest match only.',
    'Extra files from `instructions` in opencode.json (globs and URLs) are not modelled.',
  ],
};

export const cursorCliSpec: HarnessSpec = {
  id: 'cursor-cli',
  name: 'Cursor CLI',
  description:
    'AGENTS.md and CLAUDE.md at the project root plus .cursor/rules/*.mdc (alwaysApply, globs).',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [
    { title: 'Cursor CLI: using the agent', url: 'https://cursor.com/docs/cli/using' },
    { title: 'Cursor: Rules', url: 'https://cursor.com/docs/context/rules' },
  ],
  command: 'cursor-agent',
  root: { markers: ['.git'], fallback: 'repo-root' },
  traversal: 'root-only',
  files: ['AGENTS.md', 'CLAUDE.md'],
  perDirectory: 'all',
  rules: [
    {
      glob: '.cursor/rules/**/*.mdc',
      globsField: 'globs',
      alwaysField: 'alwaysApply',
      default: 'skip',
    },
  ],
  notes: [
    'The docs describe nested AGENTS.md files for the editor; CLI support for them is not confirmed, so only the root is checked.',
    'User rules live in Cursor settings, not in files, and are not shown.',
  ],
};

export const aiderSpec: HarnessSpec = {
  id: 'aider',
  name: 'Aider',
  description:
    'Aider loads no instruction file automatically; only files listed under `read:` in .aider.conf.yml.',
  fidelity: 'documented',
  verifiedOn: '2026-09-29',
  references: [
    { title: 'Aider: coding conventions', url: 'https://aider.chat/docs/usage/conventions.html' },
    { title: 'Aider: YAML config file', url: 'https://aider.chat/docs/config/aider_conf.html' },
  ],
  command: 'aider',
  global: ['~/.aider.conf.yml (read: entries)'],
  root: { markers: ['.git'], fallback: 'repo-root' },
  files: [],
  configReads: [{ file: '.aider.conf.yml', key: 'read' }],
  notes: [
    'Files added with --read or /read during a session are not modelled.',
    'Paths under `read:` are resolved relative to the config file here; Aider does not document this.',
  ],
};

export const BUILTIN_SPECS: readonly HarnessSpec[] = [
  geminiCliSpec,
  ampSpec,
  copilotCliSpec,
  openCodeSpec,
  cursorCliSpec,
  aiderSpec,
];
