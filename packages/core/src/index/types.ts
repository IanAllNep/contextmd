import type { Classification } from '../scan/classify';
import type { DocumentStats, MarkdownDocument } from '../markdown/types';

export interface IndexedDocument {
  path: string;
  size: number;
  mtimeMs: number;
  symlinkTarget?: string;
  classification: Classification;
  /** Null when the file was too large or unreadable. */
  doc: MarkdownDocument | null;
  content: string | null;
  error?: string;
}

/** Serializable per-file summary sent to UIs. */
export interface DocumentSummary {
  path: string;
  name: string;
  dir: string;
  size: number;
  mtimeMs: number;
  kind: Classification['kind'];
  patternId: string | null;
  label: string | null;
  symlinkTarget?: string;
  title: string | null;
  stats: DocumentStats | null;
  headingCount: number;
  linkCount: number;
  backlinkCount: number;
  error?: string;
}

export interface Backlink {
  from: string;
  line: number;
  text: string;
  fragment?: string;
}

export interface BrokenLink {
  from: string;
  href: string;
  line: number;
  target: string | null;
}

export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileChange {
  type: FileChangeType;
  /** Repo-relative path. */
  path: string;
}

export interface ChangeSummary {
  added: string[];
  changed: string[];
  removed: string[];
  directoriesChanged: boolean;
  rescanned: boolean;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  /** Only search agent-facing files. */
  agentOnly?: boolean;
  limit?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** Trimmed line text containing the match. */
  snippet: string;
  /** Match offsets within `snippet`. */
  matchStart: number;
  matchEnd: number;
  /** Nearest heading above the match, if any. */
  section: string | null;
}

export interface SearchResult {
  matches: SearchMatch[];
  fileCount: number;
  truncated: boolean;
  error?: string;
  elapsedMs: number;
}

export interface IndexProgress {
  phase: 'scanning' | 'parsing' | 'done';
  done: number;
  total: number;
}
