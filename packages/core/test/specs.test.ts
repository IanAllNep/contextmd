import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedContext } from '../src/context/types';
import {
  aiderSpec,
  ampSpec,
  copilotCliSpec,
  cursorCliSpec,
  geminiCliSpec,
  openCodeSpec,
} from '../src/harness/builtin-specs';
import { codexAdapter } from '../src/harness/codex';
import { createSpecAdapter } from '../src/harness/declarative';
import { buildRegistry, loadRepoSpecs } from '../src/harness/registry';
import { parseSpecText, validateSpec, type HarnessSpec } from '../src/harness/spec';
import { cleanup, makeRepo, openIndex } from './helpers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(cleanup));
});
const repo = async (files: Record<string, string>) => {
  const r = await makeRepo(files);
  roots.push(r);
  return openIndex(r);
};
const loaded = (r: ResolvedContext) =>
  r.segments
    .filter((s) => s.status === 'included' || s.status === 'truncated')
    .map((s) => s.source.path);
const statusOf = (r: ResolvedContext, path: string) =>
  r.segments.find((s) => s.source.path === path)?.status;

describe('spec validation', () => {
  it('accepts a minimal spec and reports every problem in a bad one', () => {
    expect(
      validateSpec({ id: 'my-agent', name: 'My Agent', files: ['MYAGENT.md'] }).errors,
    ).toEqual([]);
    const bad = validateSpec({
      id: 'Bad Id',
      files: ['../escape.md'],
      traversal: 'sideways',
      maxBytes: -1,
      imports: { syntax: 'at', maxDepth: 99 },
      command: 'rm -rf /\necho',
      surprise: true,
    });
    expect(bad.spec).toBeNull();
    expect(bad.errors.join('\n')).toMatch(/Unknown field "surprise"/);
    expect(bad.errors.join('\n')).toMatch(/"id"/);
    expect(bad.errors.join('\n')).toMatch(/"name" is required/);
    expect(bad.errors.join('\n')).toMatch(/relative path inside the repository/);
    expect(bad.errors.join('\n')).toMatch(/"traversal"/);
    expect(bad.errors.join('\n')).toMatch(/"maxBytes"/);
    expect(bad.errors.join('\n')).toMatch(/maxDepth/);
    expect(bad.errors.join('\n')).toMatch(/single-line/);
  });

  it('parses YAML and JSON and reports syntax errors', () => {
    expect(parseSpecText('id: a\nname: A\nfiles: [A.md]').spec?.id).toBe('a');
    expect(parseSpecText('{"id":"b","name":"B","files":["B.md"]}').spec?.id).toBe('b');
    expect(parseSpecText('id: [unclosed').errors[0]).toMatch(/Could not parse/);
  });
});

describe('declarative engine', () => {
  const codexSpec: HarnessSpec = {
    id: 'codex-declared',
    name: 'Codex (declared)',
    root: { markers: ['.git'], fallback: 'cwd' },
    traversal: 'root-to-cwd',
    files: ['AGENTS.override.md', 'AGENTS.md'],
    perDirectory: 'first',
    skipEmpty: true,
    maxBytes: 100,
    overflow: 'truncate',
  };

  it('reproduces the hand-written Codex adapter', async () => {
    const cases: [Record<string, string>, string][] = [
      [
        {
          '.git/HEAD': '',
          'AGENTS.md': 'a'.repeat(60),
          'x/AGENTS.md': 'b'.repeat(60),
          'x/y/AGENTS.md': 'c',
        },
        'x/y',
      ],
      [
        {
          '.git/HEAD': '',
          'AGENTS.md': 'root',
          'svc/AGENTS.md': 'svc',
          'svc/AGENTS.override.md': 'o',
          'svc/api/AGENTS.md': ' \n',
        },
        'svc/api',
      ],
      [{ 'AGENTS.md': 'root', 'svc/AGENTS.md': 'svc' }, 'svc'],
    ];
    for (const [files, cwd] of cases) {
      const index = await repo(files);
      const hand = await codexAdapter.resolve(index, { cwd }, { maxBytes: 100 });
      const declared = await createSpecAdapter(codexSpec).resolve(index, { cwd });
      const shape = (r: ResolvedContext) =>
        r.segments
          .filter((s) => s.source.type === 'repo')
          .map((s) => [s.source.path, s.status, s.bytes]);
      expect(shape(declared)).toEqual(shape(hand));
    }
  });

  it('marks user and repository specs as declared and drops repository commands', () => {
    const spec = { ...geminiCliSpec, id: 'x', command: 'gemini' };
    expect(createSpecAdapter(spec, 'builtin').fidelity).toBe('documented');
    expect(createSpecAdapter(spec, 'user').fidelity).toBe('declared');
    expect(createSpecAdapter(spec, 'user').command).toBe('gemini');
    const fromRepo = createSpecAdapter(spec, 'repository', '/.contextmd/harnesses/x.yaml');
    expect(fromRepo.fidelity).toBe('declared');
    expect(fromRepo.command).toBeUndefined();
  });
});

describe('built-in terminal agent specs', () => {
  it('Gemini CLI: all GEMINI.md from the git root down, imports, just-in-time subdirectories', async () => {
    const index = await repo({
      'GEMINI.md': 'outside git root',
      'app/.git/HEAD': '',
      'app/GEMINI.md': '@docs/style.md',
      'app/docs/style.md': 'style',
      'app/src/GEMINI.md': 'src',
      'app/src/lib/x.ts': '',
    });
    const r = await createSpecAdapter(geminiCliSpec).resolve(index, {
      cwd: 'app',
      file: 'app/src/lib/x.ts',
    });
    expect(loaded(r)).toEqual(['app/GEMINI.md', 'app/docs/style.md', 'app/src/GEMINI.md']);
    expect(r.segments.find((s) => s.source.path === 'app/src/GEMINI.md')?.timing).toBe('on-demand');
  });

  it('Amp: first of AGENTS.md / AGENT.md / CLAUDE.md per directory', async () => {
    const index = await repo({
      'AGENTS.md': 'a',
      'CLAUDE.md': 'c',
      'sub/AGENT.md': 'singular',
      'sub/CLAUDE.md': 'c2',
    });
    const r = await createSpecAdapter(ampSpec).resolve(index, { cwd: 'sub' });
    expect(loaded(r)).toEqual(['AGENTS.md', 'sub/AGENT.md']);
    expect(statusOf(r, 'CLAUDE.md')).toBe('skipped');
  });

  it('Copilot CLI: root instructions, combined files, applyTo-scoped instructions', async () => {
    const index = await repo({
      '.git/HEAD': '',
      '.github/copilot-instructions.md': 'repo-wide',
      '.github/instructions/ts.instructions.md': '---\napplyTo: "**/*.ts"\n---\nTS rules',
      'AGENTS.md': 'agents',
      'CLAUDE.md': 'claude',
      'api/GEMINI.md': 'gemini',
      'api/h.ts': '',
    });
    const r = await createSpecAdapter(copilotCliSpec).resolve(index, {
      cwd: 'api',
      file: 'api/h.ts',
    });
    expect(loaded(r)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      '.github/copilot-instructions.md',
      'api/GEMINI.md',
      '.github/instructions/ts.instructions.md',
    ]);
    const scoped = r.segments.find(
      (s) => s.source.path === '.github/instructions/ts.instructions.md',
    )!;
    expect(scoped.timing).toBe('on-demand');
    expect(scoped.content).toBe('TS rules');
  });

  it('OpenCode: only the nearest AGENTS.md, else CLAUDE.md', async () => {
    const index = await repo({
      'AGENTS.md': 'root',
      'pkg/CLAUDE.md': 'pkg claude',
      'pkg/deep/x.md': '',
    });
    const r = await createSpecAdapter(openCodeSpec).resolve(index, { cwd: 'pkg/deep' });
    expect(loaded(r)).toEqual(['pkg/CLAUDE.md']);
  });

  it('Cursor CLI: root files and .mdc rules by alwaysApply / globs / description', async () => {
    const index = await repo({
      'AGENTS.md': 'agents',
      'sub/AGENTS.md': 'nested',
      '.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\nalways',
      '.cursor/rules/ts.mdc': '---\nglobs: "src/**/*.ts"\n---\nts',
      '.cursor/rules/maybe.mdc': '---\ndescription: when relevant\n---\nmaybe',
      '.cursor/rules/plain.md': 'ignored: plain md',
    });
    const r = await createSpecAdapter(cursorCliSpec).resolve(index, { cwd: '', file: 'src/a.ts' });
    expect(loaded(r)).toEqual(['AGENTS.md', '.cursor/rules/always.mdc', '.cursor/rules/ts.mdc']);
    expect(statusOf(r, '.cursor/rules/maybe.mdc')).toBe('skipped');
    expect(r.segments.some((s) => s.source.path === '.cursor/rules/plain.md')).toBe(false);
  });

  it('Aider: nothing automatic, only read: entries from .aider.conf.yml', async () => {
    const index = await repo({
      '.aider.conf.yml': 'read:\n  - CONVENTIONS.md\n  - missing.md\n',
      'CONVENTIONS.md': 'conventions',
      'AGENTS.md': 'not read by aider',
    });
    const r = await createSpecAdapter(aiderSpec).resolve(index, { cwd: '' });
    expect(loaded(r)).toEqual(['CONVENTIONS.md']);
    expect(statusOf(r, 'missing.md')).toBe('skipped');
    expect(r.segments.some((s) => s.source.path === 'AGENTS.md')).toBe(false);
  });
});

describe('repository specs', () => {
  it('loads valid specs, reports invalid ones, reserves built-in ids and recognizes new files', async () => {
    const index = await repo({
      '.contextmd/harnesses/my-agent.yaml':
        'id: my-agent\nname: My Agent\nfiles: [MYAGENT.md]\ncommand: rm -rf ~\n',
      '.contextmd/harnesses/broken.yaml': 'id: broken\nfiles: nope\n',
      '.contextmd/harnesses/fake.json':
        '{"id":"claude-code","name":"Fake Claude","files":["X.md"]}',
      'MYAGENT.md': '# mine',
      'sub/MYAGENT.md': '# sub',
    });
    const reg = buildRegistry(await loadRepoSpecs(index));
    const mine = reg.adapters.find((a) => a.id === 'my-agent')!;
    expect(mine.origin).toBe('repository');
    expect(mine.command).toBeUndefined();
    expect(reg.problems.map((p) => p.source).sort()).toEqual([
      '/.contextmd/harnesses/broken.yaml',
      '/.contextmd/harnesses/fake.json',
    ]);
    expect(reg.adapters.filter((a) => a.id === 'claude-code')).toHaveLength(1);
    expect(loaded(await mine.resolve(index, { cwd: 'sub' }))).toEqual([
      'MYAGENT.md',
      'sub/MYAGENT.md',
    ]);
    index.setPatterns(reg.patterns);
    expect(index.get('MYAGENT.md')?.classification.kind).toBe('instructions');
  });
});
