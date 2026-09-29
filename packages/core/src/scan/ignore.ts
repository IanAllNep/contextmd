import ignore, { type Ignore } from 'ignore';
import { isWithin } from '../paths';

/** Directory names that are never scanned, wherever they appear. */
export const DEFAULT_IGNORED_DIRS: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'vendor',
  'coverage',
  '.gradle',
  '.idea',
  'Pods',
  'DerivedData',
];

export const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx', '.mdc'];

export function isMarkdownPath(p: string): boolean {
  const lower = p.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Stack of .gitignore matchers, each scoped to the directory containing the file.
 * Patterns in a nested .gitignore are evaluated relative to that directory, like git does.
 */
export class IgnoreRules {
  private readonly ignoredDirNames: Set<string>;
  private readonly matchers = new Map<string, Ignore>();

  constructor(
    extraIgnoredDirs: readonly string[] = [],
    readonly useGitignore = true,
  ) {
    this.ignoredDirNames = new Set([...DEFAULT_IGNORED_DIRS, ...extraIgnoredDirs]);
  }

  addGitignore(dir: string, content: string): void {
    if (!this.useGitignore) return;
    this.matchers.set(dir, ignore().add(content));
  }

  removeGitignore(dir: string): void {
    this.matchers.delete(dir);
  }

  isIgnoredDirName(name: string): boolean {
    return this.ignoredDirNames.has(name);
  }

  /** `rel` is repo-relative. Directories are tested with a trailing slash. */
  isIgnored(rel: string, isDirectory: boolean): boolean {
    if (rel === '') return false;
    const segments = rel.split('/');
    // Any ignored directory name along the path excludes it.
    const dirSegments = isDirectory ? segments : segments.slice(0, -1);
    if (dirSegments.some((s) => this.ignoredDirNames.has(s))) return true;
    for (const [base, ig] of this.matchers) {
      if (!isWithin(rel, base) || rel === base) continue;
      const sub = base === '' ? rel : rel.slice(base.length + 1);
      if (ig.ignores(isDirectory ? sub + '/' : sub)) return true;
    }
    return false;
  }
}
