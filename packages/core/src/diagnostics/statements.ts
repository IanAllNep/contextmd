import type { ContextSegment } from '../context/types';

export interface Statement {
  segmentId: string;
  path: string;
  line: number | null;
  text: string;
  normalized: string;
}

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/**
 * Extracts candidate instruction statements (list items and prose lines) from loaded
 * segments. Headings, code fences, tables and very short lines are ignored.
 */
export function extractStatements(segments: ContextSegment[]): Statement[] {
  const out: Statement[] = [];
  for (const s of segments) {
    if (s.source.type !== 'repo' || (s.status !== 'included' && s.status !== 'truncated')) continue;
    let inFence = false;
    s.content.split('\n').forEach((raw, i) => {
      const trimmed = raw.trim();
      if (/^(```|~~~)/.test(trimmed)) {
        inFence = !inFence;
        return;
      }
      if (
        inFence ||
        trimmed === '' ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('|') ||
        trimmed.startsWith('<!--')
      )
        return;
      const text = trimmed.replace(LIST_MARKER, '').replace(/^>\s*/, '');
      const normalized = normalizeStatement(text);
      if (normalized.split(' ').length < 4) return;
      out.push({
        segmentId: s.id,
        path: (s.source as { path: string }).path,
        line: s.lineMap[i] ?? null,
        text,
        normalized,
      });
    });
  }
  return out;
}

export function normalizeStatement(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
