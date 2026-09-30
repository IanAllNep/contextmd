/** Where a piece of context came from. Repo sources are repo-relative paths. */
export type SourceRef =
  | { type: 'repo'; path: string }
  /** Outside the opened repository (user/global/policy files). Display path, e.g. `~/.claude/CLAUDE.md`. */
  | { type: 'external'; path: string };

export type SegmentScope =
  'policy' | 'user' | 'project' | 'directory' | 'local' | 'rule' | 'imported' | 'target';

/**
 * - included:  content reaches the agent
 * - truncated: partially reaches the agent (e.g. size budget)
 * - skipped:   the file exists but this harness does not load it (explained in statusDetail)
 * - not-read:  a source the harness would consider, which ContextMD did not inspect
 *              (outside the repository)
 */
export type SegmentStatus = 'included' | 'truncated' | 'skipped' | 'not-read';

/** Loaded at session start, or only when the agent touches matching files. */
export type LoadTiming = 'launch' | 'on-demand';

export interface ContextSegment {
  id: string;
  source: SourceRef;
  scope: SegmentScope;
  timing: LoadTiming;
  status: SegmentStatus;
  /** Why this source was considered (the rule that selected it). */
  reason: string;
  /** Why it was skipped / truncated / not read. */
  statusDetail?: string;
  warnings: string[];
  /** For imports: the segment and line that pulled this one in. */
  via?: { segmentId: string; path: string; line: number };
  /** Import nesting depth (0 = top level). */
  depth: number;
  /** Content as the agent would receive it (after harness transforms). Empty unless included/truncated. */
  content: string;
  /** lineMap[i] = 1-based line in the source file for line i of `content`. */
  lineMap: number[];
  tokens: number;
  bytes: number;
}

export interface ContextTarget {
  /** Directory the agent is launched from (repo-relative, '' = root). */
  cwd: string;
  /** Optional file the agent is working on, for on-demand loading. */
  file?: string | null;
}

export interface ResolvedContext {
  adapterId: string;
  adapterName: string;
  fidelity: 'heuristic' | 'documented' | 'declared';
  target: ContextTarget;
  segments: ContextSegment[];
  totals: {
    tokens: number;
    bytes: number;
    files: number;
    launchTokens: number;
    onDemandTokens: number;
  };
  /** Caveats about this resolution (assumptions, things not modelled). */
  notes: string[];
  estimatorLabel: string;
  tokensExact: boolean;
}
