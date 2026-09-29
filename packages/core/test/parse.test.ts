import { describe, expect, it } from 'vitest';
import { parseMarkdown, resolveLinkTarget } from '../src/markdown/parse';

const SAMPLE = `---
title: Sample doc
tags: [a, b]
---

# Top

Intro with [a link](other.md#part) and [external](https://example.com) and [anchor](#top).

## Second level

\`\`\`bash
make test @not-an-import
\`\`\`

<!-- a maintainer comment -->

See @docs/guide.md and \`@README\` and email me@example.com.

[ref]: ../up.md
Uses a [reference link][ref].

### Third
`;

describe('parseMarkdown', () => {
  const doc = parseMarkdown('dir/sample.md', SAMPLE);

  it('extracts headings with depth, slug and line', () => {
    expect(doc.headings).toEqual([
      { depth: 1, text: 'Top', slug: 'top', line: 6 },
      { depth: 2, text: 'Second level', slug: 'second-level', line: 10 },
      { depth: 3, text: 'Third', slug: 'third', line: 23 },
    ]);
  });

  it('extracts and resolves links', () => {
    const simple = doc.links.map((l) => [l.kind, l.target ?? null, l.fragment ?? null, l.line]);
    expect(simple).toEqual([
      ['internal', 'dir/other.md', 'part', 8],
      ['external', null, null, 8],
      ['anchor', null, 'top', 8],
      ['external', null, null, 18], // GFM autolinks the email address
      ['internal', 'up.md', null, 21],
    ]);
  });

  it('extracts code blocks', () => {
    expect(doc.codeBlocks).toEqual([{ lang: 'bash', startLine: 12, endLine: 14 }]);
  });

  it('parses frontmatter', () => {
    expect(doc.frontmatter?.data).toEqual({ title: 'Sample doc', tags: ['a', 'b'] });
    expect(doc.frontmatter?.range).toEqual({ startLine: 1, endLine: 4 });
    expect(doc.title).toBe('Sample doc');
  });

  it('finds @references outside code only', () => {
    expect(doc.atReferences.map((r) => [r.path, r.line])).toEqual([['docs/guide.md', 18]]);
  });

  it('records block-level HTML comments', () => {
    expect(doc.htmlComments).toEqual([{ startLine: 16, endLine: 16 }]);
  });

  it('computes stats and a token estimate', () => {
    expect(doc.stats.characters).toBe(SAMPLE.length);
    expect(doc.stats.words).toBeGreaterThan(20);
    expect(doc.stats.tokens).toBe(Math.ceil(SAMPLE.length / 4));
  });

  it('reports frontmatter errors instead of throwing', () => {
    const bad = parseMarkdown('x.md', '---\nfoo: [unclosed\n---\n# X\n');
    expect(bad.frontmatter?.error).toBeTruthy();
    expect(bad.headings).toHaveLength(1);
  });
});

describe('resolveLinkTarget', () => {
  it('handles root-relative, parent and encoded paths', () => {
    expect(resolveLinkTarget('a/b.md', '/docs/x.md').target).toBe('docs/x.md');
    expect(resolveLinkTarget('a/b.md', '../x.md').target).toBe('x.md');
    expect(resolveLinkTarget('a/b.md', 'my%20file.md').target).toBe('a/my file.md');
    expect(resolveLinkTarget('b.md', '../../escape.md').target).toBeNull();
    expect(resolveLinkTarget('b.md', 'mailto:x@y.z').kind).toBe('external');
  });
});
