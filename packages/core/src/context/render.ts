import { displayPath } from '../paths';
import type { ContextSegment, ResolvedContext, SourceRef } from './types';

export type ExportFormat = 'markdown' | 'plain' | 'json';

export interface OutputLine {
  segmentId: string | null;
  source: SourceRef | null;
  /** 1-based line in the source file, or null for separator/header lines. */
  sourceLine: number | null;
}

export interface RenderedContext {
  text: string;
  /** One entry per output line: the line-level source map. */
  lines: OutputLine[];
}

export function sourceLabel(source: SourceRef): string {
  return source.type === 'repo' ? displayPath(source.path) : source.path;
}

export function isLoaded(s: ContextSegment): boolean {
  return s.status === 'included' || s.status === 'truncated';
}

export interface RenderOptions {
  format?: Exclude<ExportFormat, 'json'>;
  /** Include on-demand segments (default true). */
  includeOnDemand?: boolean;
  header?: boolean;
}

/**
 * Concatenates loaded segments with explicit source boundaries and builds a line-level
 * source map so any output line can be traced back to its origin.
 */
export function renderContext(
  resolved: ResolvedContext,
  options: RenderOptions = {},
): RenderedContext {
  const format = options.format ?? 'markdown';
  const out: string[] = [];
  const lines: OutputLine[] = [];
  const push = (
    text: string,
    info: OutputLine = { segmentId: null, source: null, sourceLine: null },
  ) => {
    out.push(text);
    lines.push(info);
  };
  const segments = resolved.segments.filter(
    (s) => isLoaded(s) && (options.includeOnDemand !== false || s.timing === 'launch'),
  );
  const total = segments.reduce((n, s) => n + s.tokens, 0);
  const target = resolved.target.file
    ? `${displayPath(resolved.target.cwd)} (working on ${displayPath(resolved.target.file)})`
    : displayPath(resolved.target.cwd);

  if (options.header !== false) {
    const tokenLabel = `${resolved.tokensExact ? '' : '~'}${total.toLocaleString('en-US')} tokens${resolved.tokensExact ? '' : ' (estimate)'}`;
    const header = `Effective context · ${resolved.adapterName} · target ${target} · ${segments.length} sources · ${tokenLabel}`;
    push(format === 'markdown' ? `<!-- ${header} -->` : header);
    push('');
  }

  segments.forEach((s, i) => {
    if (i > 0) push('');
    const extra = [
      s.timing === 'on-demand' ? 'on-demand' : null,
      s.status === 'truncated' ? 'truncated' : null,
    ]
      .filter(Boolean)
      .join(', ');
    const label = sourceLabel(s.source) + (extra ? ` (${extra})` : '');
    const boundary = { segmentId: s.id, source: s.source, sourceLine: null };
    push(
      format === 'markdown' ? `<!-- SOURCE: ${label} -->` : `===== SOURCE: ${label} =====`,
      boundary,
    );
    push('', boundary);
    s.content.split('\n').forEach((text, li) => {
      push(text, { segmentId: s.id, source: s.source, sourceLine: s.lineMap[li] ?? null });
    });
  });
  return { text: out.join('\n') + '\n', lines };
}

export function exportContext(resolved: ResolvedContext, format: ExportFormat): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        adapter: resolved.adapterId,
        fidelity: resolved.fidelity,
        target: resolved.target,
        totals: resolved.totals,
        tokenEstimator: resolved.estimatorLabel,
        notes: resolved.notes,
        segments: resolved.segments.map(({ lineMap: _lineMap, ...s }) => s),
      },
      null,
      2,
    );
  }
  return renderContext(resolved, { format }).text;
}
