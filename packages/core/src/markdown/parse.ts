import GithubSlugger from 'github-slugger';
import type { Root, RootContent, Nodes } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit, SKIP } from 'unist-util-visit';
import YAML from 'yaml';
import { dirnameRel, normalizeRel } from '../paths';
import { defaultEstimator, type TokenEstimator } from '../tokens/estimate';
import type {
  AtReference,
  CodeBlock,
  Frontmatter,
  Heading,
  LineRange,
  MarkdownDocument,
  MarkdownLink,
} from './types';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

export function parseMarkdownAst(content: string): Root {
  return processor.parse(content);
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveLinkTarget(
  fromPath: string,
  href: string,
): Pick<MarkdownLink, 'kind' | 'target' | 'fragment'> {
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return { kind: 'anchor', fragment: trimmed.slice(1) };
  if (SCHEME_RE.test(trimmed) || trimmed.startsWith('//')) return { kind: 'external' };
  const hashIdx = trimmed.indexOf('#');
  const pathPart = (hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx)).split('?')[0] ?? '';
  const fragment = hashIdx === -1 ? undefined : trimmed.slice(hashIdx + 1);
  let decoded = pathPart;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    /* keep raw */
  }
  const joined = decoded.startsWith('/') ? decoded : `${dirnameRel(fromPath)}/${decoded}`;
  const target = normalizeRel(joined);
  return fragment === undefined
    ? { kind: 'internal', target }
    : { kind: 'internal', target, fragment };
}

// `@` at start of text or after whitespace/opening punctuation, followed by a path-like token.
const AT_REF_RE = /(^|[\s(])@((?:~\/|\.{1,2}\/|\/)?[\w.-][\w./~-]*)/g;

function extractAtReferences(text: string, startLine: number, startColumn: number): AtReference[] {
  const refs: AtReference[] = [];
  const lines = text.split('\n');
  lines.forEach((lineText, i) => {
    for (const m of lineText.matchAll(AT_REF_RE)) {
      let path = m[2] ?? '';
      path = path.replace(/[.,;:!?)]+$/, ''); // trailing sentence punctuation
      if (path === '' || /^\d+$/.test(path)) continue;
      const col = (m.index ?? 0) + (m[1]?.length ?? 0);
      refs.push({
        raw: '@' + path,
        path,
        line: startLine + i,
        column: i === 0 ? startColumn + col : col + 1,
      });
    }
  });
  return refs;
}

function parseFrontmatter(node: RootContent & { value: string }): Frontmatter {
  const range: LineRange = {
    startLine: node.position?.start.line ?? 1,
    endLine: node.position?.end.line ?? 1,
  };
  try {
    const data: unknown = YAML.parse(node.value);
    return {
      raw: node.value,
      data:
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null,
      error: null,
      range,
    };
  } catch (e) {
    return {
      raw: node.value,
      data: null,
      error: e instanceof Error ? e.message : String(e),
      range,
    };
  }
}

const HTML_COMMENT_RE = /^\s*<!--[\s\S]*?-->\s*$/;

export interface ParseOptions {
  estimator?: TokenEstimator;
}

export function parseMarkdown(
  path: string,
  content: string,
  options: ParseOptions = {},
): MarkdownDocument {
  const estimator = options.estimator ?? defaultEstimator;
  const tree = parseMarkdownAst(content);
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const links: MarkdownLink[] = [];
  const codeBlocks: CodeBlock[] = [];
  const atReferences: AtReference[] = [];
  const htmlComments: LineRange[] = [];
  const definitions = new Map<string, string>();
  const linkRefs: { identifier: string; text: string; line: number; column: number }[] = [];
  let frontmatter: Frontmatter | null = null;

  visit(tree, (node: Nodes, _index, parent) => {
    const line = node.position?.start.line ?? 1;
    const column = node.position?.start.column ?? 1;
    switch (node.type) {
      case 'yaml':
        if (parent?.type === 'root' && frontmatter === null) frontmatter = parseFrontmatter(node);
        return SKIP;
      case 'heading': {
        const text = toString(node).trim();
        headings.push({ depth: node.depth, text, slug: slugger.slug(text), line });
        break;
      }
      case 'link':
        links.push({
          href: node.url,
          text: toString(node),
          line,
          column,
          ...resolveLinkTarget(path, node.url),
        });
        return SKIP; // text inside links is not an @reference
      case 'definition':
        definitions.set(node.identifier, node.url);
        return SKIP;
      case 'linkReference':
        linkRefs.push({ identifier: node.identifier, text: toString(node), line, column });
        return SKIP;
      case 'code':
        codeBlocks.push({
          lang: node.lang ?? null,
          startLine: line,
          endLine: node.position?.end.line ?? line,
        });
        return SKIP;
      case 'inlineCode':
        return SKIP;
      case 'html':
        if (parent?.type === 'root' && HTML_COMMENT_RE.test(node.value)) {
          htmlComments.push({ startLine: line, endLine: node.position?.end.line ?? line });
        }
        return SKIP;
      case 'text':
        atReferences.push(...extractAtReferences(node.value, line, column));
        return SKIP;
    }
    return undefined;
  });

  for (const ref of linkRefs) {
    const url = definitions.get(ref.identifier);
    if (url === undefined) continue;
    links.push({
      href: url,
      text: ref.text,
      line: ref.line,
      column: ref.column,
      ...resolveLinkTarget(path, url),
    });
  }
  links.sort((a, b) => a.line - b.line || a.column - b.column);

  const fmData = (frontmatter as Frontmatter | null)?.data;
  const fmTitle = typeof fmData?.['title'] === 'string' ? fmData['title'] : null;
  const firstH1 = headings.find((h) => h.depth === 1)?.text ?? null;

  return {
    path,
    headings,
    links,
    codeBlocks,
    atReferences,
    htmlComments,
    frontmatter,
    title: fmTitle ?? firstH1,
    stats: {
      words: content.match(/\S+/g)?.length ?? 0,
      characters: content.length,
      lines: content === '' ? 0 : content.split('\n').length,
      tokens: estimator.estimate(content),
    },
  };
}
