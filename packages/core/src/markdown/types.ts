export interface Heading {
  depth: number;
  text: string;
  /** GitHub-style anchor slug, unique within the document. */
  slug: string;
  /** 1-based line of the heading. */
  line: number;
}

export type LinkKind = 'internal' | 'anchor' | 'external';

export interface MarkdownLink {
  href: string;
  text: string;
  kind: LinkKind;
  line: number;
  column: number;
  /** For internal links: repo-relative target path (null if it escapes the repository). */
  target?: string | null;
  /** '#fragment' part without the '#'. */
  fragment?: string;
}

export interface CodeBlock {
  lang: string | null;
  startLine: number;
  endLine: number;
}

/** A `@path` reference outside code (Claude Code and Gemini CLI import syntax). */
export interface AtReference {
  raw: string;
  path: string;
  line: number;
  column: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface Frontmatter {
  raw: string;
  data: Record<string, unknown> | null;
  error: string | null;
  range: LineRange;
}

export interface DocumentStats {
  words: number;
  characters: number;
  lines: number;
  tokens: number;
}

/** Everything ContextMD knows about one Markdown file, without its raw content. */
export interface MarkdownDocument {
  path: string;
  headings: Heading[];
  links: MarkdownLink[];
  codeBlocks: CodeBlock[];
  atReferences: AtReference[];
  /** Block-level HTML comments (Claude Code strips these before injecting CLAUDE.md). */
  htmlComments: LineRange[];
  frontmatter: Frontmatter | null;
  title: string | null;
  stats: DocumentStats;
}
