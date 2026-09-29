import { identity, type MappedContent } from '../context/transform';
import type {
  ContextSegment,
  ContextTarget,
  LoadTiming,
  ResolvedContext,
  SegmentScope,
  SourceRef,
} from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';
import { utf8ByteLength } from '../tokens/estimate';
import type { HarnessAdapter } from './types';

export interface SegmentInit {
  source: SourceRef;
  scope: SegmentScope;
  timing?: LoadTiming;
  reason: string;
  depth?: number;
  via?: ContextSegment['via'];
  warnings?: string[];
}

/** Accumulates segments for a resolution; shared by all adapters. */
export class ContextBuilder {
  readonly segments: ContextSegment[] = [];
  readonly notes: string[] = [];
  /** Canonical repo paths already loaded (symlinks resolved), to avoid double-loading. */
  private readonly loaded = new Map<string, string>();

  constructor(
    private readonly index: RepositoryIndex,
    private readonly adapter: Pick<HarnessAdapter, 'id' | 'name' | 'fidelity'>,
    private readonly target: ContextTarget,
  ) {}

  /** Real path for dedup: a symlinked CLAUDE.md → AGENTS.md is the same file. */
  canonical(path: string): string {
    return this.index.get(path)?.symlinkTarget ?? path;
  }

  loadedBy(path: string): string | undefined {
    return this.loaded.get(this.canonical(path));
  }

  private base(
    init: SegmentInit,
  ): Omit<ContextSegment, 'status' | 'content' | 'lineMap' | 'tokens' | 'bytes'> {
    const seg: Omit<ContextSegment, 'status' | 'content' | 'lineMap' | 'tokens' | 'bytes'> = {
      id: `s${this.segments.length}`,
      source: init.source,
      scope: init.scope,
      timing: init.timing ?? 'launch',
      reason: init.reason,
      warnings: init.warnings ?? [],
      depth: init.depth ?? 0,
    };
    if (init.via) seg.via = init.via;
    return seg;
  }

  include(init: SegmentInit, mapped: MappedContent, truncatedDetail?: string): ContextSegment {
    const seg: ContextSegment = {
      ...this.base(init),
      status: truncatedDetail ? 'truncated' : 'included',
      content: mapped.content,
      lineMap: mapped.lineMap,
      tokens: this.index.estimator.estimate(mapped.content),
      bytes: utf8ByteLength(mapped.content),
    };
    if (truncatedDetail) seg.statusDetail = truncatedDetail;
    if (init.source.type === 'repo') this.loaded.set(this.canonical(init.source.path), seg.id);
    this.segments.push(seg);
    return seg;
  }

  skip(
    init: SegmentInit,
    detail: string,
    status: 'skipped' | 'not-read' = 'skipped',
  ): ContextSegment {
    const seg: ContextSegment = {
      ...this.base(init),
      status,
      statusDetail: detail,
      content: '',
      lineMap: [],
      tokens: 0,
      bytes: 0,
    };
    this.segments.push(seg);
    return seg;
  }

  /** Content of an indexed document, or null. */
  content(path: string): MappedContent | null {
    const c = this.index.get(path)?.content;
    return c === null || c === undefined ? null : identity(c);
  }

  finish(): ResolvedContext {
    const loaded = this.segments.filter((s) => s.status === 'included' || s.status === 'truncated');
    const sum = (xs: ContextSegment[], f: (s: ContextSegment) => number) =>
      xs.reduce((n, s) => n + f(s), 0);
    return {
      adapterId: this.adapter.id,
      adapterName: this.adapter.name,
      fidelity: this.adapter.fidelity,
      target: this.target,
      segments: this.segments,
      totals: {
        tokens: sum(loaded, (s) => s.tokens),
        bytes: sum(loaded, (s) => s.bytes),
        files: loaded.length,
        launchTokens: sum(
          loaded.filter((s) => s.timing === 'launch'),
          (s) => s.tokens,
        ),
        onDemandTokens: sum(
          loaded.filter((s) => s.timing === 'on-demand'),
          (s) => s.tokens,
        ),
      },
      notes: this.notes,
      estimatorLabel: this.index.estimator.label,
      tokensExact: this.index.estimator.exact,
    };
  }
}
