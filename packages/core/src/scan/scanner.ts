import type { FileSystem } from '../fs/types';
import { joinRel, toAbs, toRel } from '../paths';
import { IgnoreRules, isMarkdownPath } from './ignore';

export interface ScannedFile {
  path: string;
  size: number;
  mtimeMs: number;
  /** Repo-relative target when this file is a symlink to another file in the repository. */
  symlinkTarget?: string;
}

export interface ScanOptions {
  extraIgnoredDirs?: readonly string[];
  useGitignore?: boolean;
  /** Hard cap on directory entries visited, to stay responsive on huge trees. */
  maxEntries?: number;
  /** Project-root marker names recorded while scanning (e.g. for Codex). */
  rootMarkers?: readonly string[];
}

export interface ScanResult {
  markdown: ScannedFile[];
  directories: string[];
  /** Directories containing a root marker such as `.git`. */
  markerDirs: Record<string, string[]>;
  ignoredCount: number;
  entriesVisited: number;
  truncated: boolean;
}

export const DEFAULT_ROOT_MARKERS = ['.git', '.hg', '.sl'] as const;

/**
 * Walks the repository once. Only Markdown files are recorded as files; every non-ignored
 * directory is recorded so any directory can be a context target.
 * Symlinked directories are not followed. Symlinked Markdown files are included only if
 * they resolve inside the repository.
 */
export async function scanRepository(
  fs: FileSystem,
  root: string,
  options: ScanOptions = {},
  rules = new IgnoreRules(options.extraIgnoredDirs, options.useGitignore ?? true),
): Promise<ScanResult> {
  const maxEntries = options.maxEntries ?? 250_000;
  const markers = new Set(options.rootMarkers ?? DEFAULT_ROOT_MARKERS);
  const realRoot = await fs.realpath(root);
  const result: ScanResult = {
    markdown: [],
    directories: [],
    markerDirs: {},
    ignoredCount: 0,
    entriesVisited: 0,
    truncated: false,
  };

  const queue: string[] = [''];
  for (let qi = 0; qi < queue.length; qi++) {
    const dir = queue[qi]!;
    result.directories.push(dir);
    let entries;
    try {
      entries = await fs.readDir(toAbs(root, dir));
    } catch {
      continue; // unreadable directory: skip, never fail the whole scan
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // Load this directory's .gitignore first so it applies to its siblings.
    if (entries.some((e) => e.name === '.gitignore' && e.isFile)) {
      try {
        rules.addGitignore(dir, await fs.readFile(toAbs(root, joinRel(dir, '.gitignore'))));
      } catch {
        /* unreadable .gitignore is ignored */
      }
    }

    for (const entry of entries) {
      result.entriesVisited++;
      if (result.entriesVisited > maxEntries) {
        result.truncated = true;
        return result;
      }
      const rel = joinRel(dir, entry.name);
      if (markers.has(entry.name)) (result.markerDirs[dir] ??= []).push(entry.name);

      if (entry.isDirectory) {
        if (rules.isIgnored(rel, true)) {
          result.ignoredCount++;
          continue;
        }
        queue.push(rel);
      } else if (entry.isFile && isMarkdownPath(entry.name)) {
        if (rules.isIgnored(rel, false)) {
          result.ignoredCount++;
          continue;
        }
        try {
          const st = await fs.stat(toAbs(root, rel));
          result.markdown.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* vanished during scan */
        }
      } else if (entry.isSymbolicLink && isMarkdownPath(entry.name)) {
        if (rules.isIgnored(rel, false)) continue;
        const file = await statSymlinkedFile(fs, root, realRoot, rel);
        if (file) result.markdown.push(file);
      }
    }
  }
  return result;
}

export async function statSymlinkedFile(
  fs: FileSystem,
  root: string,
  realRoot: string,
  rel: string,
): Promise<ScannedFile | null> {
  try {
    const real = await fs.realpath(toAbs(root, rel));
    const target = toRel(realRoot, real);
    if (target === null) return null; // points outside the repository: not followed
    const st = await fs.stat(real);
    if (!st.isFile) return null;
    return { path: rel, size: st.size, mtimeMs: st.mtimeMs, symlinkTarget: target };
  } catch {
    return null; // dangling link
  }
}
