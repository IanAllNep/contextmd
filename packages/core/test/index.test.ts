import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fixtureCopy, makeRepo, openIndex, write } from './helpers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(cleanup));
});

describe('backlinks', () => {
  it('reports every document linking to a target', async () => {
    const root = await makeRepo({
      'a.md': 'see [b](b.md)',
      'c.md': 'also [b](./b.md#section) and [self](c.md)',
      'b.md': '# B',
    });
    roots.push(root);
    const index = await openIndex(root);
    expect(index.backlinks('b.md').map((b) => [b.from, b.fragment ?? null])).toEqual([
      ['a.md', null],
      ['c.md', 'section'],
    ]);
    expect(index.backlinks('c.md')).toEqual([]); // self-links excluded
    expect(index.summary('b.md')?.backlinkCount).toBe(2);
  });

  it('resolves extensionless and directory links', async () => {
    const root = await makeRepo({
      'a.md': '[g](guide) [d](docs/)',
      'guide.md': '',
      'docs/README.md': '',
    });
    roots.push(root);
    const index = await openIndex(root);
    expect(index.backlinks('guide.md')).toHaveLength(1);
    expect(index.backlinks('docs/README.md')).toHaveLength(1);
  });

  it('finds fixture backlinks and broken links', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    expect(index.backlinks('backend/architecture.md').map((b) => b.from)).toEqual([
      'AGENTS.md',
      'docs/overview.md',
      'README.md',
    ]);
    const broken = await index.brokenLinks();
    expect(broken.map((b) => [b.from, b.target])).toEqual([
      ['frontend/styling.md', 'docs/tokens.md'],
    ]);
  });
});

describe('search', () => {
  it('returns file, line, column, section and snippet', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    const r = index.search('parameterized');
    expect(r.matches).toHaveLength(1);
    const m = r.matches[0]!;
    expect(m.path).toBe('backend/prompts/database.md');
    expect(m.line).toBe(11);
    expect(m.section).toBe('Queries');
    expect(m.snippet.slice(m.matchStart, m.matchEnd).toLowerCase()).toBe('parameterized');
  });

  it('is case-insensitive by default and supports regex + agentOnly', async () => {
    const root = await fixtureCopy();
    roots.push(root);
    const index = await openIndex(root);
    expect(index.search('MAKE TEST').fileCount).toBe(3);
    expect(index.search('MAKE TEST', { caseSensitive: true }).fileCount).toBe(0);
    expect(index.search('make test', { agentOnly: true }).fileCount).toBe(2);
    expect(index.search('migrat(ion|ions)', { regex: true }).matches.length).toBeGreaterThan(1);
    expect(index.search('(', { regex: true }).error).toBeTruthy();
  });
});

describe('incremental updates', () => {
  it('handles add, change and remove', async () => {
    const root = await makeRepo({ 'a.md': '# A\n[b](b.md)', 'b.md': '# B' });
    roots.push(root);
    const index = await openIndex(root);

    await write(root, 'sub/c.md', '# C\n[b](../b.md)');
    let s = await index.applyChanges([
      { type: 'addDir', path: 'sub' },
      { type: 'add', path: 'sub/c.md' },
    ]);
    expect(s.added).toEqual(['sub/c.md']);
    expect(index.hasDirectory('sub')).toBe(true);
    expect(index.backlinks('b.md')).toHaveLength(2);

    await writeFile(join(root, 'a.md'), '# A renamed heading');
    s = await index.applyChanges([{ type: 'change', path: 'a.md' }]);
    expect(s.changed).toEqual(['a.md']);
    expect(index.get('a.md')?.doc?.headings[0]?.text).toBe('A renamed heading');
    expect(index.backlinks('b.md')).toHaveLength(1);

    await rm(join(root, 'sub'), { recursive: true });
    s = await index.applyChanges([{ type: 'unlinkDir', path: 'sub' }]);
    expect(s.removed).toEqual(['sub/c.md']);
    expect(index.has('sub/c.md')).toBe(false);
    expect(index.hasDirectory('sub')).toBe(false);
    expect(index.backlinks('b.md')).toHaveLength(0);
  });

  it('ignores events for ignored paths and non-markdown files', async () => {
    const root = await makeRepo({ 'a.md': '' });
    roots.push(root);
    const index = await openIndex(root);
    await write(root, 'node_modules/x/README.md', '');
    await write(root, 'code.ts', '');
    const s = await index.applyChanges([
      { type: 'add', path: 'node_modules/x/README.md' },
      { type: 'add', path: 'code.ts' },
    ]);
    expect(s.added).toEqual([]);
    expect(index.size).toBe(1);
  });

  it('rescans when a .gitignore changes', async () => {
    const root = await makeRepo({ 'a.md': '', 'private/b.md': '' });
    roots.push(root);
    const index = await openIndex(root);
    expect(index.has('private/b.md')).toBe(true);
    await write(root, '.gitignore', 'private/\n');
    const s = await index.applyChanges([{ type: 'add', path: '.gitignore' }]);
    expect(s.rescanned).toBe(true);
    expect(s.removed).toEqual(['private/b.md']);
  });
});
