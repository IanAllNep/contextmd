import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportContext, renderContext } from '../src/context/render';
import type { ResolvedContext } from '../src/context/types';
import { analyzeContext } from '../src/diagnostics/analyze';
import { claudeCodeAdapter } from '../src/harness/claude-code';
import { codexAdapter } from '../src/harness/codex';
import { genericAdapter } from '../src/harness/generic';
import { cleanup, fixtureCopy, makeRepo, openIndex, write } from './helpers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(cleanup));
});

const loaded = (r: ResolvedContext) =>
  r.segments
    .filter((s) => s.status === 'included' || s.status === 'truncated')
    .map((s) => s.source.path);
const statusOf = (r: ResolvedContext, path: string) =>
  r.segments.find((s) => s.source.path === path)?.status;

describe('generic adapter', () => {
  it('orders ancestor instruction files from root to target directory', async () => {
    const root = await makeRepo({
      'AGENTS.md': '# root',
      'backend/AGENTS.md': '# backend',
      'backend/api/handler.ts': 'export {}',
      'frontend/AGENTS.md': '# frontend',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: 'backend/api' });
    expect(loaded(r)).toEqual(['AGENTS.md', 'backend/AGENTS.md']);
    expect(r.fidelity).toBe('heuristic');
    expect(r.totals.files).toBe(2);
    expect(r.totals.tokens).toBe(r.segments.reduce((n, s) => n + s.tokens, 0));
  });

  it('appends the target document and includes CLAUDE.md alongside AGENTS.md', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: '', file: 'backend/prompts/database.md' });
    expect(loaded(r)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'backend/AGENTS.md',
      'backend/prompts/database.md',
    ]);
    expect(r.segments.at(-1)?.scope).toBe('target');
  });

  it('does not load a symlinked file twice', async () => {
    const root = await makeRepo({ 'AGENTS.md': '# shared' });
    roots.push(root);
    await symlink(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: '' });
    expect(loaded(r)).toEqual(['AGENTS.md']);
    expect(statusOf(r, 'CLAUDE.md')).toBe('skipped');
  });
});

describe('claude code adapter', () => {
  it('loads CLAUDE.md with its @import, unconditional rules, and skips AGENTS.md by default', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: '' });
    expect(loaded(r)).toEqual(['CLAUDE.md', 'AGENTS.md', '.claude/rules/testing.md']);
    const imported = r.segments.find(
      (s) => s.source.path === 'AGENTS.md' && s.status === 'included',
    )!;
    expect(imported.scope).toBe('imported');
    expect(imported.via).toMatchObject({ path: 'CLAUDE.md', line: 1 });
    // Backticked `@README.md` is not an import
    expect(r.segments.some((s) => s.source.path === 'README.md')).toBe(false);
    // Path-scoped rule is listed but not loaded without a matching working file
    expect(statusOf(r, '.claude/rules/api.md')).toBe('skipped');
    // External sources are shown as not read
    expect(r.segments.filter((s) => s.status === 'not-read').map((s) => s.source.path)).toContain(
      '~/.claude/CLAUDE.md',
    );
  });

  it('strips block-level HTML comments and keeps an accurate line map', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: '' });
    const claude = r.segments.find((s) => s.source.path === 'CLAUDE.md')!;
    expect(claude.content).not.toContain('Maintainer note');
    const idx = claude.content
      .split('\n')
      .findIndex((l) => l.startsWith('## Claude Code specifics'));
    expect(claude.lineMap[idx]).toBe(8);
    expect(claude.warnings.join(' ')).toMatch(/HTML comment/);
  });

  it('skips nested AGENTS.md (CLAUDE.md present) and loads on-demand files + matching path-scoped rules', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: '', file: 'backend/api/handler.ts' });
    expect(statusOf(r, 'backend/AGENTS.md')).toBe('skipped');
    const api = r.segments.find((s) => s.source.path === '.claude/rules/api.md')!;
    expect(api.status).toBe('included');
    expect(api.timing).toBe('on-demand');
    expect(api.content).not.toContain('paths:'); // frontmatter removed
  });

  it('reads AGENTS.md when no CLAUDE.md exists (default mode) and both in "and" mode', async () => {
    const root = await makeRepo({
      'AGENTS.md': '# agents',
      'sub/AGENTS.md': '# sub agents',
      'sub/x.ts': '',
    });
    roots.push(root);
    const index = await openIndex(root);
    let r = await claudeCodeAdapter.resolve(index, { cwd: '', file: 'sub/x.ts' });
    expect(loaded(r)).toEqual(['AGENTS.md', 'sub/AGENTS.md']);
    expect(r.segments.find((s) => s.source.path === 'sub/AGENTS.md')?.timing).toBe('on-demand');

    await write(root, 'CLAUDE.md', '# claude');
    await index.applyChanges([{ type: 'add', path: 'CLAUDE.md' }]);
    r = await claudeCodeAdapter.resolve(index, { cwd: '' });
    expect(loaded(r)).toEqual(['CLAUDE.md']);
    r = await claudeCodeAdapter.resolve(
      index,
      { cwd: '' },
      { instructionFiles: 'claude-md-and-agents-md' },
    );
    expect(loaded(r)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('orders CLAUDE.local.md after CLAUDE.md, parent directories first', async () => {
    const root = await makeRepo({
      'CLAUDE.md': 'root',
      'CLAUDE.local.md': 'root local',
      'pkg/CLAUDE.md': 'pkg',
      'pkg/.claude/CLAUDE.md': 'pkg dot-claude',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: 'pkg' });
    expect(loaded(r)).toEqual([
      'CLAUDE.md',
      'CLAUDE.local.md',
      'pkg/CLAUDE.md',
      'pkg/.claude/CLAUDE.md',
    ]);
  });

  it('limits import depth to four hops and resolves imports relative to the importing file', async () => {
    const root = await makeRepo({
      'CLAUDE.md': '@docs/one.md',
      'docs/one.md': '@two.md',
      'docs/two.md': '@three.md',
      'docs/three.md': '@four.md',
      'docs/four.md': '@five.md',
      'docs/five.md': 'too deep',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: '' });
    expect(loaded(r)).toEqual([
      'CLAUDE.md',
      'docs/one.md',
      'docs/two.md',
      'docs/three.md',
      'docs/four.md',
    ]);
    expect(r.segments.find((s) => s.source.path === 'docs/five.md')?.statusDetail).toMatch(
      /maximum import depth/,
    );
  });

  it('imports non-Markdown files and marks missing / external ones', async () => {
    const root = await makeRepo({
      'CLAUDE.md': 'See @package.json and @~/.claude/me.md and @missing.md',
      'package.json': '{}',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await claudeCodeAdapter.resolve(index, { cwd: '' });
    expect(statusOf(r, 'package.json')).toBe('included');
    expect(statusOf(r, '~/.claude/me.md')).toBe('not-read');
    expect(statusOf(r, 'missing.md')).toBe('skipped');
  });
});

describe('codex adapter', () => {
  it('walks from the git root to cwd, one file per directory, override first', async () => {
    const root = await makeRepo({
      '.git/HEAD': 'ref',
      'AGENTS.md': 'root',
      'svc/AGENTS.md': 'svc',
      'svc/AGENTS.override.md': 'svc override',
      'svc/api/AGENTS.md': '   \n',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await codexAdapter.resolve(index, { cwd: 'svc/api' });
    expect(loaded(r)).toEqual(['AGENTS.md', 'svc/AGENTS.override.md']);
    expect(r.segments.find((s) => s.source.path === 'svc/AGENTS.md')?.statusDetail).toMatch(
      /one file per directory/,
    );
    expect(r.segments.find((s) => s.source.path === 'svc/api/AGENTS.md')?.statusDetail).toMatch(
      /Empty/,
    );
  });

  it('only checks cwd without a project root and supports fallback filenames', async () => {
    const root = await makeRepo({ 'AGENTS.md': 'root', 'svc/CLAUDE.md': 'claude' });
    roots.push(root);
    const index = await openIndex(root);
    let r = await codexAdapter.resolve(index, { cwd: 'svc' });
    expect(loaded(r)).toEqual([]);
    r = await codexAdapter.resolve(index, { cwd: 'svc' }, { fallbackFilenames: 'CLAUDE.md' });
    expect(loaded(r)).toEqual(['svc/CLAUDE.md']);
  });

  it('truncates at the combined byte budget', async () => {
    const root = await makeRepo({
      '.git/HEAD': '',
      'AGENTS.md': 'a'.repeat(60),
      'x/AGENTS.md': 'b'.repeat(60),
      'x/y/AGENTS.md': 'c',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await codexAdapter.resolve(index, { cwd: 'x/y' }, { maxBytes: 100 });
    expect(statusOf(r, 'AGENTS.md')).toBe('included');
    const x = r.segments.find((s) => s.source.path === 'x/AGENTS.md')!;
    expect(x.status).toBe('truncated');
    expect(x.bytes).toBe(40);
    expect(statusOf(r, 'x/y/AGENTS.md')).toBe('skipped');
    expect(r.totals.bytes).toBe(100);
  });
});

describe('rendering and provenance', () => {
  it('renders source boundaries and a line-level source map', async () => {
    const root = await makeRepo({ 'AGENTS.md': '# Root\nline two', 'a/AGENTS.md': '# A' });
    roots.push(root);
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: 'a' });
    const out = renderContext(r);
    expect(out.text).toContain('<!-- SOURCE: /AGENTS.md -->');
    expect(out.text).toContain('<!-- SOURCE: /a/AGENTS.md -->');
    const lines = out.text.split('\n');
    const i = lines.indexOf('line two');
    expect(out.lines[i]).toMatchObject({
      source: { type: 'repo', path: 'AGENTS.md' },
      sourceLine: 2,
    });
    expect(exportContext(r, 'plain')).toContain('===== SOURCE: /a/AGENTS.md =====');
    expect(JSON.parse(exportContext(r, 'json')).segments).toHaveLength(2);
  });
});

describe('diagnostics', () => {
  it('finds duplicated instructions and the fixture conflict', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: 'backend' });
    const diags = analyzeContext(r, { experimentalConflicts: true });
    const dups = diags.filter((d) => d.kind === 'duplicate');
    expect(dups.map((d) => d.sources.map((s) => s.path))).toContainEqual([
      'AGENTS.md',
      'backend/AGENTS.md',
    ]);
    expect(dups.map((d) => d.sources.map((s) => s.path))).toContainEqual([
      'AGENTS.md',
      'CLAUDE.md',
    ]);
    const conflicts = diags.filter((d) => d.kind === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.sources.map((s) => [s.path, s.line])).toEqual([
      ['AGENTS.md', 14],
      ['backend/AGENTS.md', 7],
    ]);
    expect(analyzeContext(r).some((d) => d.kind === 'conflict')).toBe(false); // flag off by default
  });

  it('does not flag unrelated negative/affirmative statements', async () => {
    const root = await makeRepo({
      'AGENTS.md': '- Never commit secrets to the repository.',
      'a/AGENTS.md': '- Commit small changes often with clear messages.',
    });
    roots.push(root);
    const index = await openIndex(root);
    const r = await genericAdapter.resolve(index, { cwd: 'a' });
    expect(analyzeContext(r, { experimentalConflicts: true })).toEqual([]);
  });
});
