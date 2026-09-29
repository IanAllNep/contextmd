import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classify } from '../src/scan/classify';
import { IgnoreRules } from '../src/scan/ignore';
import { scanRepository } from '../src/scan/scanner';
import { cleanup, fixtureCopy, fs, makeRepo } from './helpers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(cleanup));
});

describe('markdown discovery', () => {
  it('finds .md files in nested directories and ignores excluded ones', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const scan = await scanRepository(fs, root);
    const paths = scan.markdown.map((f) => f.path).sort();
    expect(paths).toEqual([
      '.claude/rules/api.md',
      '.claude/rules/testing.md',
      '.claude/skills/release/SKILL.md',
      'AGENTS.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
      'README.md',
      'backend/AGENTS.md',
      'backend/architecture.md',
      'backend/prompts/database.md',
      'docs/overview.md',
      'frontend/AGENTS.md',
      'frontend/styling.md',
    ]);
    // node_modules and dist are built-in ignores, scratch/ comes from .gitignore
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(paths.some((p) => p.startsWith('dist'))).toBe(false);
    expect(paths.some((p) => p.startsWith('scratch'))).toBe(false);
    // every non-ignored directory is recorded, even ones without Markdown
    expect(scan.directories).toContain('backend/api');
    expect(scan.directories).not.toContain('node_modules');
  });

  it('honours nested .gitignore files relative to their directory', async () => {
    const root = await makeRepo({
      'a.md': '# a',
      'pkg/.gitignore': 'generated/\nlocal.md\n',
      'pkg/keep.md': '# keep',
      'pkg/local.md': '# ignored',
      'pkg/generated/x.md': '# ignored',
      'other/local.md': '# not ignored: different directory',
    });
    roots.push(root);
    const scan = await scanRepository(fs, root);
    expect(scan.markdown.map((f) => f.path).sort()).toEqual([
      'a.md',
      'other/local.md',
      'pkg/keep.md',
    ]);
  });

  it('recognizes instruction files and records symlinks inside the repo', async () => {
    const root = await makeRepo({ 'AGENTS.md': '# shared' });
    roots.push(root);
    await symlink(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
    const scan = await scanRepository(fs, root);
    const claude = scan.markdown.find((f) => f.path === 'CLAUDE.md');
    expect(claude?.symlinkTarget).toBe('AGENTS.md');
  });

  it('does not follow symlinks that leave the repository', async () => {
    const outside = await makeRepo({ 'secret.md': '# outside' });
    const root = await makeRepo({ 'a.md': '# a' });
    roots.push(outside, root);
    await symlink(join(outside, 'secret.md'), join(root, 'escape.md'));
    await symlink(outside, join(root, 'linked-dir'));
    const scan = await scanRepository(fs, root);
    expect(scan.markdown.map((f) => f.path)).toEqual(['a.md']);
  });

  it('records project-root markers', async () => {
    const root = await makeRepo({
      '.git/HEAD': 'ref: refs/heads/main',
      'sub/.git/HEAD': 'x',
      'a.md': '',
    });
    roots.push(root);
    const scan = await scanRepository(fs, root);
    expect(scan.markerDirs['']).toEqual(['.git']);
    expect(scan.markerDirs['sub']).toEqual(['.git']);
  });
});

describe('classification', () => {
  it.each([
    ['AGENTS.md', 'instructions', 'agents-md'],
    ['backend/AGENTS.md', 'instructions', 'agents-md'],
    ['CLAUDE.md', 'instructions', 'claude-md'],
    ['.claude/CLAUDE.md', 'instructions', 'claude-md'],
    ['CLAUDE.local.md', 'instructions', 'claude-local-md'],
    ['.claude/rules/api/x.md', 'rule', 'claude-rule'],
    ['.claude/skills/release/SKILL.md', 'skill', 'claude-skill'],
    ['.claude/commands/fix.md', 'command', 'claude-command'],
    ['.github/copilot-instructions.md', 'instructions', 'copilot-instructions'],
    ['readme.md', 'project-doc', 'readme'],
    ['CONTRIBUTING.md', 'project-doc', 'contributing'],
    ['docs/guide.md', 'doc', null],
  ])('%s → %s', (path, kind, pattern) => {
    const c = classify(path);
    expect(c.kind).toBe(kind);
    expect(c.patternId).toBe(pattern);
  });
});

describe('IgnoreRules', () => {
  it('ignores files under a gitignored directory', () => {
    const r = new IgnoreRules();
    r.addGitignore('', 'build-output/\n*.tmp.md\n');
    expect(r.isIgnored('build-output/a.md', false)).toBe(true);
    expect(r.isIgnored('x.tmp.md', false)).toBe(true);
    expect(r.isIgnored('node_modules/a/README.md', false)).toBe(true);
    expect(r.isIgnored('docs/a.md', false)).toBe(false);
  });
});
